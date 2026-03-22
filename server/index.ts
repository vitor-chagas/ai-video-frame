import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes, cleanupExpiredVideos } from "./routes";
import { storage } from "./storage";
import { serveStatic } from "./static";
import { createServer } from "http";

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

const app = express();
// Trust proxy MUST be set before any middleware (like session) to correctly handle HTTPS behind Railway's load balancer
app.set("trust proxy", 1);

// Block requests to sensitive paths before any other middleware
app.use((req, res, next) => {
  if (/^\/(\.env|\.git|\.htaccess|\.ssh|wp-admin|phpinfo)/i.test(req.path)) {
    return res.status(404).end();
  }
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://app.posthog.com", "https://cdn.posthog.com", "https://js.stripe.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.googleusercontent.com"],
      connectSrc: ["'self'", "https://app.posthog.com", "https://api.stripe.com", "https://*.stripe.com"],
      mediaSrc: ["'self'", "blob:"],
      frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"],
      workerSrc: ["'self'", "blob:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  permissionsPolicy: {
    features: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
    },
  },
} as any));
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

import { log } from "./utils/logger";
export { log };

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        // Redact sensitive fields from logs
        const redactedResponse = { ...capturedJsonResponse };
        const sensitiveKeys = [
          "access_token", 
          "refresh_token", 
          "password", 
          "id_token", 
          "session_secret", 
          "token", 
          "sessionId", 
          "stripe-signature",
          "checkoutUrl",
          "url"
        ];
        
        for (const key of sensitiveKeys) {
          if (key in redactedResponse) {
            redactedResponse[key] = "[REDACTED]";
          }
        }
        
        logLine += ` :: ${JSON.stringify(redactedResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  // Background cleanup job: Every 5 minutes
  setInterval(() => {
    cleanupExpiredVideos().catch(err => console.error("Scheduled cleanup failed:", err));
  }, 5 * 60 * 1000);

  // Cleanup stale "uploaded" videos every 5 minutes (videos stuck in uploaded state for more than 5 minutes)
  setInterval(async () => {
    try {
      const staleVideos = await storage.deleteStaleUploadedVideos(5 * 60 * 1000);
      if (staleVideos.length > 0) {
        log(`Removed ${staleVideos.length} stale uploaded videos`, "Cleanup");
      }
    } catch (err) {
      console.error("Stale video cleanup failed:", err);
    }
  }, 5 * 60 * 1000);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  
  // Set global timeouts to handle large file downloads
  // 1 hour timeout for long video transfers
  httpServer.timeout = 3600000;
  httpServer.keepAliveTimeout = 65000;
  httpServer.headersTimeout = 66000;
  // This ensures the response doesn't timeout while streaming large files
  httpServer.requestTimeout = 3600000;

  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
