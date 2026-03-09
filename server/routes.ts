import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { authStorage } from "./auth/storage";
import { setupAuth, registerAuthRoutes, isAuthenticated, getUserId } from "./auth";
import multer from "multer";
import path from "path";
import { spawn, execFile } from "child_process";
import fs from "fs";
import { promisify } from "util";
import express from "express";
import { rateLimit } from "express-rate-limit";

const execFileAsync = promisify(execFile);
const unlinkAsync = promisify(fs.unlink);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const ALLOWED_RATIOS = ["9:16", "1:1", "4:5", "16:9", "2:3"];

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

const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
const videoProgress: Map<string, number> = new Map();

const CLEANUP_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes

async function deleteVideoFiles(video: { originalPath?: string | null; processedPath?: string | null }) {
  if (video.originalPath && fs.existsSync(video.originalPath)) {
    await unlinkAsync(video.originalPath).catch(() => {});
  }
  if (video.processedPath && fs.existsSync(video.processedPath)) {
    await unlinkAsync(video.processedPath).catch(() => {});
  }
}

async function getStripe() {
  const Stripe = (await import("stripe")).default;
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
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
          console.log(`[Cleanup] Protected active file: ${filePath}`);
          continue;
        }

        const stats = await statAsync(filePath);
        const age = now.getTime() - stats.mtime.getTime();
        if (age > CLEANUP_THRESHOLD_MS) {
          await unlinkAsync(filePath).catch(() => {});
          console.log(`[Cleanup] Deleted expired file: ${filePath}`);
        }
      }
    }
  } catch (error) {
    console.error("Error during scheduled cleanup:", error);
  }
}

async function getVideoDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-select_streams", "v:0",
      "-show_entries", "stream=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath
    ]);
    let duration = parseFloat(stdout.trim());
    
    if (isNaN(duration)) {
      const { stdout: stdoutFormat } = await execFileAsync("ffprobe", [
        "-v", "quiet",
        "-analyzeduration", "1000000",
        "-probesize", "1000000",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        filePath
      ]);
      duration = parseFloat(stdoutFormat.trim());
    }

    console.log(`[FFprobe] Duration for ${filePath}: ${duration}s`);
    return isNaN(duration) ? null : Math.round(duration);
  } catch (error) {
    console.error("Error getting video duration:", error);
    return null;
  }
}

function calculateRequiredCredits(durationInSeconds: number | null): number {
  if (durationInSeconds === null) return 1;
  if (durationInSeconds <= 300) return 1;
  const additionalSeconds = durationInSeconds - 300;
  const additionalCredits = Math.ceil(additionalSeconds / 60);
  return 1 + additionalCredits;
}

const upload = multer({
  dest: "uploads/input/",
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowedExts = [".mp4", ".mov", ".avi"];
    const allowedMimeTypes = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/avi"];
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype;
    if (allowedExts.includes(ext) && allowedMimeTypes.includes(mimeType)) {
      cb(null, true);
    } else {
      cb(new Error("Only MP4, MOV, and AVI files are allowed"));
    }
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);

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

      const duration = await getVideoDuration(file.path);
      
      const video = await storage.createVideo({
        userId,
        originalFilename: file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_"),
        originalPath: file.path,
        aspectRatio,
        fileSize: file.size,
        duration,
      });

      return res.json(video);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/videos", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req)!;
    const vids = await storage.getVideosByUser(userId);
    return res.json(vids);
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
      console.log(`[API] Wiping abandoned upload: ${latest.id}`);
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
    return res.json({ ...latest, progress });
  });

  app.get("/api/videos/:id", isAuthenticated, async (req: Request, res: Response) => {
    const videoId = req.params.id as string;
    const userId = getUserId(req)!;
    const video = await storage.getVideo(videoId);
    if (!video || video.userId !== userId) {
      return res.status(404).json({ message: "Video not found" });
    }
    const progress = videoProgress.get(videoId) ?? 0;
    return res.json({ ...video, progress });
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
      return res.status(500).json({ message: error.message });
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
      return res.status(500).json({ message: error.message });
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
        priceId = process.env.STRIPE_PRICE_SINGLE!;
        mode = "payment";
      } else if (plan === "monthly") {
        credits = 12;
        priceId = process.env.STRIPE_PRICE_MONTHLY!;
        mode = "subscription";
      } else if (plan === "yearly") {
        credits = 144;
        priceId = process.env.STRIPE_PRICE_YEARLY!;
        mode = "subscription";
      } else {
        return res.status(400).json({ message: "Invalid plan" });
      }

      if (!process.env.STRIPE_SECRET_KEY) {
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
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/payments/confirm-credits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ message: "sessionId is required" });
      const userId = getUserId(req)!;
      if (!process.env.STRIPE_SECRET_KEY) return res.json({ status: "completed", credits: 0 });

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
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/videos/:id/process", isAuthenticated, processingLimiter, async (req: Request, res: Response) => {
    try {
      const videoId = req.params.id as string;
      const userId = getUserId(req)!;
      const video = await storage.getVideo(videoId);
      if (!video || video.userId !== userId) return res.status(404).json({ message: "Video not found" });

      const requiredCredits = calculateRequiredCredits(video.duration);
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

      const pythonProcess = spawn("python3", [
        "python_scripts/auto_frame.py",
        "--input", video.originalPath,
        "--output", outputPath,
        "--ratio", video.aspectRatio,
      ]);

      pythonProcess.stdout.on("data", (data) => {
        const output = data.toString();
        const match = output.match(/Progress:\s*([\d.]+)%/);
        if (match) videoProgress.set(video.id, parseFloat(match[1]));
      });

      pythonProcess.on("close", async (code) => {
        videoProgress.delete(video.id);
        if (code === 0) {
          await storage.updateVideoStatus(video.id, "completed", outputPath);
        } else {
          await storage.updateVideoStatus(video.id, "failed");
        }
        const tempFiles = fs.readdirSync(".").filter(f => f.startsWith("temp_no_audio_") && f.endsWith(".mp4"));
        for (const tmpFile of tempFiles) {
          try { fs.unlinkSync(tmpFile); } catch {}
        }
      });

      return res.json({ message: "Processing started", videoId: video.id });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/webhooks/stripe", async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret || !sig) return res.status(400).send("Webhook Error: Missing secret or signature");
    let event;
    try {
      const stripe = await getStripe();
      event = stripe.webhooks.constructEvent((req as any).rawBody, sig, webhookSecret);
    } catch (err: any) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
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
      if (!process.env.STRIPE_SECRET_KEY) return res.status(400).json({ message: "Stripe is not configured" });
      const stripe = await getStripe();
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${req.protocol}://${req.get("host")}/`,
      });
      return res.json({ url: session.url });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
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
      if (!res.headersSent) res.status(500).json({ message: error.message });
    }
  });

  return httpServer;
}
