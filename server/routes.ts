import type { Express, Request, Response } from "express";
import { config } from "./config";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { authStorage } from "./auth/storage";
import { setupAuth, registerAuthRoutes, isAuthenticated, getUserId } from "./auth";
import { log } from "./utils/logger";
import path from "path";
import { spawn } from "child_process";
import fs from "fs";
import { promisify } from "util";
import { rateLimit } from "express-rate-limit";
import {
  upload,
  videoProgress,
  getVideoDuration,
  calculateRequiredCredits,
  deleteVideoFiles,
  unlinkAsync,
  downscaleIfNeeded,
  ALLOWED_RATIOS,
} from "./video-processing";
import v1VideosRouter from "./routes/v1/videos";
import { setupSwaggerDocs } from "./swagger";
import { sanitizeVideo } from "./utils/sanitize";

const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Rate limiters
const uploadLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 10,
  message: { message: "Too many uploads from this IP, please try again after 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

const processingLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 20,
  message: { message: "Too many processing requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const CLEANUP_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes

async function getStripe() {
  const Stripe = (await import("stripe")).default;
  return new Stripe(config.STRIPE_SECRET_KEY);
}

export async function cleanupUserFiles(userId: string) {
  try {
    const videos = await storage.getVideosByUser(userId);
    for (const video of videos) {
      if (video.status === "processing") continue;

      await deleteVideoFiles(video);
    }
  } catch (error) {
    console.error("Error during user file cleanup:", error);
  }
}

export async function cleanupExpiredVideos() {
  try {
    const now = new Date();
    const directories = ["uploads/input", "uploads/output"];
    
    const allVideos = await storage.getAllProcessingVideos();
    const processingPaths = new Set(
      allVideos
        .map(v => v.originalPath)
        .filter(Boolean) as string[]
    );

    for (const dir of directories) {
      if (!fs.existsSync(dir)) continue;
      const files = await readdirAsync(dir);
      for (const file of files) {
        if (file === ".gitkeep" || file === ".DS_Store") continue;
        const filePath = path.join(dir, file);
        
        if (processingPaths.has(filePath)) {
          log(`Protected active file: ${filePath}`, "Cleanup");
          continue;
        }

        const stats = await statAsync(filePath);
        const age = now.getTime() - stats.mtime.getTime();
        if (age > CLEANUP_THRESHOLD_MS) {
          await unlinkAsync(filePath).catch(() => {});
          log(`Deleted expired file: ${filePath}`, "Cleanup");
        }
      }
    }
  } catch (error) {
    console.error("Error during scheduled cleanup:", error);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);

  // Security contact info for researchers
  app.get("/.well-known/security.txt", (_req, res) => {
    res.type("text/plain").send(
      `Contact: mailto:contact@aivideoframe.com\nExpires: 2027-01-01T00:00:00.000Z\n`
    );
  });

  // Public API v1 (RapidAPI)
  app.use("/api/v1/videos", v1VideosRouter);
  setupSwaggerDocs(app);

  app.post("/api/videos/upload", isAuthenticated, uploadLimiter, upload.single("video"), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "No video file uploaded" });
      }

      const userId = getUserId(req)!;
      await cleanupUserFiles(userId);
      await storage.deleteAllUserVideos(userId);

      const aspectRatio = req.body.aspectRatio || "9:16";

      if (!ALLOWED_RATIOS.includes(aspectRatio)) {
        return res.status(400).json({ message: "Invalid aspect ratio" });
      }

      await downscaleIfNeeded(file.path);
      const stat = fs.statSync(file.path);
      const duration = await getVideoDuration(file.path);

      const video = await storage.createVideo({
        userId,
        originalFilename: file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_"),
        originalPath: file.path,
        aspectRatio,
        fileSize: stat.size,
        duration,
      });

      return res.json(video);
    } catch (error: any) {
      const message = error.message?.includes("1080p") ? error.message : "Internal server error";
      return res.status(400).json({ message });
    }
  });

  app.get("/api/videos", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req)!;
    const vids = await storage.getVideosByUser(userId);
    return res.json(vids.map(sanitizeVideo));
  });

  app.get("/api/videos/latest", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req)!;
    const vids = await storage.getVideosByUser(userId);
    if (vids.length === 0) return res.json(null);
    
    const latest = vids.sort((a, b) => 
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    )[0];

    // Wipe out "uploaded" videos immediately on refresh - always start fresh unless processing/done
    if (latest.status === "uploaded") {
      log(`Wiping abandoned upload: ${latest.id}`, "API");
      if (latest.originalPath && fs.existsSync(latest.originalPath)) {
        await unlinkAsync(latest.originalPath).catch(() => {});
      }
      await storage.deleteVideo(latest.id);
      return res.json(null);
    }

    const age = new Date().getTime() - new Date(latest.createdAt || 0).getTime();
    if (age > CLEANUP_THRESHOLD_MS) return res.json(null);

    // Verify files still exist for processing/completed videos
    if (latest.status === "processing") {
      if (!latest.originalPath || !fs.existsSync(latest.originalPath)) {
        await storage.deleteVideo(latest.id);
        return res.json(null);
      }
    } else if (latest.status === "completed") {
      if (!latest.processedPath || !fs.existsSync(latest.processedPath)) {
        await storage.deleteVideo(latest.id);
        return res.json(null);
      }
    }

    const progress = videoProgress.get(latest.id) ?? 0;
    return res.json({ ...sanitizeVideo(latest), progress });
  });

  app.get("/api/videos/:id", isAuthenticated, async (req: Request, res: Response) => {
    const videoId = req.params.id as string;
    const userId = getUserId(req)!;
    const video = await storage.getVideo(videoId);
    if (!video || video.userId !== userId) {
      return res.status(404).json({ message: "Video not found" });
    }
    const progress = videoProgress.get(videoId) ?? 0;
    return res.json({ ...sanitizeVideo(video), progress });
  });

  app.delete("/api/videos/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const videoId = req.params.id as string;
      const userId = getUserId(req)!;
      const video = await storage.getVideo(videoId);
      if (!video || video.userId !== userId) {
        return res.status(404).json({ message: "Video not found" });
      }
      await deleteVideoFiles(video);
      await storage.deleteVideo(videoId);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/videos/reset", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req)!;
      const videos = await storage.getVideosByUser(userId);
      for (const video of videos) {
        if (video.status !== "processing") {
          await deleteVideoFiles(video);
          await storage.deleteVideo(video.id);
        }
      }
      await storage.deleteAllUserVideos(userId);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/payments/create-credits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { plan, returnVideoId, quantity } = req.body;
      const userId = getUserId(req)!;
      let credits = 0;
      let priceId = "";
      let mode: "payment" | "subscription" = "payment";
      let stripeQuantity = 1;

      if (plan === "single") {
        credits = quantity || 1;
        stripeQuantity = credits;
        priceId = config.STRIPE_PRICE_SINGLE;
        mode = "payment";
      } else if (plan === "monthly") {
        credits = 12;
        priceId = config.STRIPE_PRICE_MONTHLY;
        mode = "subscription";
      } else if (plan === "yearly") {
        credits = 144;
        priceId = config.STRIPE_PRICE_YEARLY;
        mode = "subscription";
      } else {
        return res.status(400).json({ message: "Invalid plan" });
      }

      if (!config.STRIPE_SECRET_KEY) {
        await authStorage.updateUserCredits(userId, credits);
        return res.json({ simulated: true, status: "completed" });
      }

      if (!priceId) {
        return res.status(400).json({ message: `Stripe Price ID for plan '${plan}' is not configured` });
      }

      const stripe = await getStripe();
      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: priceId, quantity: stripeQuantity }],
        mode: mode,
        metadata: { userId, credits: credits.toString(), plan },
        success_url: `${req.protocol}://${req.get("host")}/?payment=success&sessionId={CHECKOUT_SESSION_ID}${returnVideoId ? `&returnVideoId=${returnVideoId}` : ''}`,
        cancel_url: `${req.protocol}://${req.get("host")}/?payment=cancelled`,
      });
      return res.json({ checkoutUrl: session.url });
    } catch (error: any) {
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/payments/confirm-credits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ message: "sessionId is required" });
      const userId = getUserId(req)!;
      if (!config.STRIPE_SECRET_KEY) return res.json({ status: "completed", credits: 0 });

      const stripe = await getStripe();
      const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);

      if (stripeSession.payment_status === "paid") {
        const credits = parseInt(stripeSession.metadata?.credits || "0");
        const metadataUserId = stripeSession.metadata?.userId;
        const customerId = stripeSession.customer as string;
        const subscriptionId = stripeSession.subscription as string | undefined;
        if (metadataUserId !== userId) return res.status(403).json({ message: "Unauthorized" });
        await authStorage.updateUserCredits(userId, credits);
        if (customerId) await authStorage.updateUserStripeInfo(userId, customerId, subscriptionId);
        return res.json({ status: "completed", credits });
      } else {
        return res.json({ status: "pending" });
      }
    } catch (error: any) {
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/videos/:id/process", isAuthenticated, processingLimiter, async (req: Request, res: Response) => {
    try {
      const videoId = req.params.id as string;
      const userId = getUserId(req)!;
      const video = await storage.getVideo(videoId);
      if (!video || video.userId !== userId) return res.status(404).json({ message: "Video not found" });

      const subtitles = req.body.subtitles === true || req.body.subtitles === "true";
      const subtitleLanguage: string | null = req.body.subtitleLanguage || null;
      const subtitleMode: string = ["burn", "srt", "vtt"].includes(req.body.subtitleMode) ? req.body.subtitleMode : "burn";

      const requiredCredits = calculateRequiredCredits(video.duration, subtitles);
      const user = await authStorage.getUser(userId);
      if (!user || (user.credits || 0) < requiredCredits) {
        return res.status(402).json({ message: `Insufficient credits. This video requires ${requiredCredits} credits.`, requiredCredits });
      }

      if (video.status === "processing") return res.status(400).json({ message: "Video is already being processed" });
      if (video.status === "completed") return res.status(400).json({ message: "Video has already been processed" });

      const updatedUser = await authStorage.updateUserCredits(userId, -requiredCredits);
      if (!updatedUser || updatedUser.credits < 0) {
        if (updatedUser) await authStorage.updateUserCredits(userId, requiredCredits);
        return res.status(402).json({ message: `Insufficient credits. This video requires ${requiredCredits} credits.`, requiredCredits });
      }

      await storage.updateVideoStatus(video.id, "processing");
      const ext = path.extname(video.originalFilename) || ".mp4";
      const outputFilename = `auto_${video.aspectRatio.replace(":", "_")}_${video.id}${ext}`;
      const outputPath = path.join("uploads/output", outputFilename);

      const pythonArgs = [
        "python_scripts/auto_frame.py",
        "--input", video.originalPath,
        "--output", outputPath,
        "--ratio", video.aspectRatio,
      ];

      let srtPath: string | null = null;
      if (subtitles) {
        srtPath = outputPath.replace(/\.[^.]+$/, ".srt");
        pythonArgs.push("--subtitles");
        if (subtitleLanguage) pythonArgs.push("--subtitle-lang", subtitleLanguage);
        pythonArgs.push("--subtitle-mode", subtitleMode);
        pythonArgs.push("--subtitle-output", srtPath);
      }

      const pythonProcess = spawn("python3", pythonArgs);

      let stdoutBuffer = "";
      pythonProcess.stdout.on("data", (data) => {
        const output = data.toString();
        stdoutBuffer += output;

        const frameMatch = output.match(/Progress:\s*([\d.]+)%/);
        if (frameMatch) {
          const pct = parseFloat(frameMatch[1]);
          videoProgress.set(video.id, subtitles ? pct * 0.8 : pct);
        }

        const subMatch = output.match(/SubtitleProgress:\s*([\d.]+)%/);
        if (subMatch) {
          const subPct = parseFloat(subMatch[1]);
          videoProgress.set(video.id, 80 + subPct * 0.2);
        }
      });

      let stderrBuffer = "";
      pythonProcess.stderr.on("data", (data) => {
        const output = data.toString();
        stderrBuffer += output;
        console.error("[Python stderr]", output);
      });

      pythonProcess.on("close", async (code) => {
        videoProgress.delete(video.id);
        if (code === 0) {
          await storage.updateVideoStatus(video.id, "completed", outputPath);
          // Parse detected language and persist subtitle path if subtitles were generated
          if (subtitles && srtPath) {
            const langMatch = stdoutBuffer.match(/DetectedLanguage:\s*(\S+)/);
            const detectedLang = langMatch ? langMatch[1] : "unknown";
            await storage.updateVideoSubtitles(video.id, detectedLang, srtPath);
          }
        } else {
          console.error(`[videos] Processing failed for ${video.id} with exit code ${code}`);
          if (stderrBuffer) console.error("[videos] stderr:", stderrBuffer);
          if (stdoutBuffer) console.error("[videos] stdout:", stdoutBuffer);
          await storage.updateVideoStatus(video.id, "failed");
        }
        const tempFiles = fs.readdirSync(".").filter(f => f.startsWith("temp_no_audio_") && f.endsWith(".mp4"));
        for (const tmpFile of tempFiles) {
          try { fs.unlinkSync(tmpFile); } catch {}
        }
      });

      return res.json({ message: "Processing started", videoId: video.id });
    } catch (error: any) {
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/webhooks/stripe", async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = config.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret || !sig) return res.status(400).send("Webhook Error: Missing secret or signature");
    let event;
    try {
      const stripe = await getStripe();
      event = stripe.webhooks.constructEvent((req as any).rawBody, sig, webhookSecret);
    } catch (err: any) {
      return res.status(400).send("Webhook Error: Invalid payload or signature");
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;
      const userId = session.metadata?.userId;
      const credits = parseInt(session.metadata?.credits || "0");
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string | undefined;
      if (userId && credits > 0) {
        await authStorage.updateUserCredits(userId, credits);
        if (customerId) await authStorage.updateUserStripeInfo(userId, customerId, subscriptionId);
      }
    }
    res.json({ received: true });
  });

  app.post("/api/payments/create-portal", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req)!;
      const user = await authStorage.getUser(userId);
      if (!user || !user.stripeCustomerId) return res.status(400).json({ message: "No active subscription or customer found" });
      if (!config.STRIPE_SECRET_KEY) return res.status(400).json({ message: "Stripe is not configured" });
      const stripe = await getStripe();
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${req.protocol}://${req.get("host")}/`,
      });
      return res.json({ url: session.url });
    } catch (error: any) {
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/videos/:id/download", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const vid = req.params.id as string;
      const userId = getUserId(req)!;
      const video = await storage.getVideo(vid);
      if (!video || video.userId !== userId) return res.status(404).json({ message: "Video not found" });
      if (video.status !== "completed" || !video.processedPath) return res.status(400).json({ message: "Video not ready for download" });
      const absolutePath = path.resolve(video.processedPath);
      const uploadsDir = path.resolve("./uploads");
      if (!absolutePath.startsWith(uploadsDir + path.sep) && absolutePath !== uploadsDir) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!fs.existsSync(absolutePath)) return res.status(404).json({ message: "Processed file not found" });
      const stat = await statAsync(absolutePath);
      const safeName = video.originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 100);
      const ext = path.extname(video.processedPath) || ".mp4";
      const downloadName = `aivideoframe_${safeName}${safeName.endsWith(ext) ? '' : ext}`;
      req.setTimeout(3600000);
      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Length": stat.size,
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "no-cache"
      });
      fs.createReadStream(absolutePath).pipe(res);
    } catch (error: any) {
      if (!res.headersSent) res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/videos/:id/subtitles", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const vid = req.params.id as string;
      const userId = getUserId(req)!;
      const video = await storage.getVideo(vid);
      if (!video || video.userId !== userId) return res.status(404).json({ message: "Video not found" });
      if (!video.subtitlePath || !video.subtitleMode || video.subtitleMode === "burn") {
        return res.status(400).json({ message: "No subtitle file available for this video" });
      }
      const absolutePath = path.resolve(video.subtitlePath);
      const uploadsDir = path.resolve("./uploads");
      if (!absolutePath.startsWith(uploadsDir + path.sep) && absolutePath !== uploadsDir) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!fs.existsSync(absolutePath)) return res.status(404).json({ message: "Subtitle file not found" });
      const isVtt = video.subtitleMode === "vtt";
      const safeName = video.originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 100);
      const ext = isVtt ? ".vtt" : ".srt";
      const downloadName = `aivideoframe_${safeName}${ext}`;
      res.writeHead(200, {
        "Content-Type": isVtt ? "text/vtt" : "text/srt",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "no-cache",
      });
      fs.createReadStream(absolutePath).pipe(res);
    } catch (error: any) {
      if (!res.headersSent) res.status(500).json({ message: "Internal server error" });
    }
  });

  return httpServer;
}
