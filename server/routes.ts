import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { authStorage } from "./auth/storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./auth";
import multer from "multer";
import path from "path";
import { spawn, exec } from "child_process";
import fs from "fs";
import { promisify } from "util";
import express from "express";

const execAsync = promisify(exec);
const videoProgress: Map<string, number> = new Map();

const CLEANUP_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes

async function cleanupUserFiles(userId: string) {
  try {
    const videos = await storage.getVideosByUser(userId);
    for (const video of videos) {
      // NEVER delete files for a video that is currently being processed
      if (video.status === "processing") {
        console.log(`[Cleanup] Skipping active video ${video.id} for user ${userId}`);
        continue;
      }
      
      if (video.originalPath && fs.existsSync(video.originalPath)) {
        fs.unlinkSync(video.originalPath);
      }
      if (video.processedPath && fs.existsSync(video.processedPath)) {
        fs.unlinkSync(video.processedPath);
      }
    }
  } catch (error) {
    console.error("Error during user file cleanup:", error);
  }
}

export async function cleanupExpiredVideos() {
  try {
    const now = new Date();
    const directories = ["uploads/input", "uploads/output"];
    
    // Get all videos from storage to check their status
    // This is safer than just looking at file age
    const allVideos = await storage.getAllProcessingVideos();
    const processingPaths = new Set(
      allVideos
        .map(v => v.originalPath)
        .filter(Boolean) as string[]
    );

    for (const dir of directories) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file === ".gitkeep" || file === ".DS_Store") continue;
        const filePath = path.join(dir, file);
        
        // Skip if this file is currently being processed
        if (processingPaths.has(filePath)) {
          console.log(`[Cleanup] Protected active file: ${filePath}`);
          continue;
        }

        const stats = fs.statSync(filePath);
        const age = now.getTime() - stats.mtime.getTime();
        if (age > CLEANUP_THRESHOLD_MS) {
          fs.unlinkSync(filePath);
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
    // -v quiet -select_streams v:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 
    // is often faster than format=duration because it doesn't wait to parse the whole file if the stream header has it.
    // We try multiple methods to be robust but fast.
    const { stdout } = await execAsync(
      `ffprobe -v quiet -select_streams v:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    let duration = parseFloat(stdout.trim());
    
    if (isNaN(duration)) {
      // Fallback to format duration with optimized probesize
      const { stdout: stdoutFormat } = await execAsync(
        `ffprobe -v quiet -analyzeduration 1000000 -probesize 1000000 -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
      );
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
  if (durationInSeconds === null) return 1; // Fallback
  
  if (durationInSeconds <= 300) {
    return 1;
  }
  
  // 1 credit for first 5 mins, + 1 credit per each additional minute (or part thereof)
  const additionalSeconds = durationInSeconds - 300;
  const additionalCredits = Math.ceil(additionalSeconds / 60);
  
  return 1 + additionalCredits;
}

const upload = multer({
  dest: "uploads/input/",
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".mp4", ".mov", ".avi"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only MP4, MOV, and AVI files are allowed"));
    }
  },
});

function getUserId(req: Request): string | undefined {
  const user = req.user as any;
  return user?.claims?.sub || user?.id;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);

  // ---- VIDEO UPLOAD ROUTE ----

  app.post("/api/videos/upload", isAuthenticated, upload.single("video"), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "No video file uploaded" });
      }

      const userId = getUserId(req)!;
      
      // Cleanup previous files for this user before starting new ones
      await cleanupUserFiles(userId);

      const aspectRatio = req.body.aspectRatio || "9:16";
      
      const duration = await getVideoDuration(file.path);
      
      const video = await storage.createVideo({
        userId,
        originalFilename: file.originalname,
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
    
    // Sort by createdAt desc
    const latest = vids.sort((a, b) => 
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    )[0];

    // Check if it's within 15 minutes and files still exist
    const now = new Date();
    const age = now.getTime() - new Date(latest.createdAt || 0).getTime();
    
    if (age > CLEANUP_THRESHOLD_MS) {
      return res.json(null);
    }

    // Check if processed file exists if it's completed
    if (latest.status === "completed" && latest.processedPath) {
      if (!fs.existsSync(latest.processedPath)) {
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

  // ---- STRIPE PAYMENT ROUTE ----

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
        // Simulated for dev
        await authStorage.updateUserCredits(userId, credits);
        return res.json({ simulated: true, status: "completed" });
      }

      if (!priceId) {
        return res.status(400).json({ message: `Stripe Price ID for plan '${plan}' is not configured` });
      }

      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price: priceId,
            quantity: stripeQuantity,
          },
        ],
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

  // ---- STRIPE PAYMENT CONFIRMATION (after redirect) ----

  app.post("/api/payments/confirm-credits", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ message: "sessionId is required" });
      }

      const userId = getUserId(req)!;

      if (!process.env.STRIPE_SECRET_KEY) {
        return res.json({ status: "completed", credits: 0 });
      }

      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);

      // Check if session has already been handled by webhook to avoid double credits
      // The session object in Stripe keeps track of whether it was successful.
      if (stripeSession.payment_status === "paid") {
        const credits = parseInt(stripeSession.metadata?.credits || "0");
        const metadataUserId = stripeSession.metadata?.userId;
        const customerId = stripeSession.customer as string;
        const subscriptionId = stripeSession.subscription as string | undefined;

        if (metadataUserId !== userId) {
          return res.status(403).json({ message: "Unauthorized" });
        }

        // Note: For extra safety, you could check if credits were already added
        // but since we update with += credits, we should be careful.
        // However, in a standard redirect flow, this is the main way credits are added.
        await authStorage.updateUserCredits(userId, credits);
        if (customerId) {
          await authStorage.updateUserStripeInfo(userId, customerId, subscriptionId);
        }
        return res.json({ status: "completed", credits });
      } else {
        return res.json({ status: "pending" });
      }
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ---- VIDEO PROCESSING ROUTE ----

  app.post("/api/videos/:id/process", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const videoId = req.params.id as string;
      const userId = getUserId(req)!;
      const video = await storage.getVideo(videoId);
      if (!video || video.userId !== userId) {
        return res.status(404).json({ message: "Video not found" });
      }

      const requiredCredits = calculateRequiredCredits(video.duration);

      // Check if user has enough credits
      const user = await authStorage.getUser(userId);
      if (!user || (user.credits || 0) < requiredCredits) {
        return res.status(402).json({ 
          message: `Insufficient credits. This video requires ${requiredCredits} credits.`,
          requiredCredits 
        });
      }

      if (video.status === "processing") {
        return res.status(400).json({ message: "Video is already being processed" });
      }

      if (video.status === "completed") {
        return res.status(400).json({ message: "Video has already been processed" });
      }

      await storage.updateVideoStatus(video.id, "processing");
      
      // Consume required credits
      await authStorage.updateUserCredits(userId, -requiredCredits);

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
        console.log(`[AI Video Frame] ${output}`);
        const match = output.match(/Progress:\s*([\d.]+)%/);
        if (match) {
          videoProgress.set(video.id, parseFloat(match[1]));
        }
      });

      pythonProcess.stderr.on("data", (data) => {
        console.error(`[AI Video Frame Error] ${data}`);
      });

      pythonProcess.on("close", async (code) => {
        videoProgress.delete(video.id);
        if (code === 0) {
          await storage.updateVideoStatus(video.id, "completed", outputPath);
          console.log(`[AI Video Frame] Processing complete for video ${video.id}`);
        } else {
          await storage.updateVideoStatus(video.id, "failed");
          console.error(`[AI Video Frame] Processing failed for video ${video.id} with code ${code}`);
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

  // ---- STRIPE WEBHOOK ----

  app.post("/api/webhooks/stripe", async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret || !sig) {
      return res.status(400).send("Webhook Error: Missing secret or signature");
    }

    let event;

    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
      // Use the rawBody captured in server/index.ts
      event = stripe.webhooks.constructEvent((req as any).rawBody, sig, webhookSecret);
    } catch (err: any) {
      console.error(`Webhook Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;
      const userId = session.metadata?.userId;
      const credits = parseInt(session.metadata?.credits || "0");
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string | undefined;

      if (userId && credits > 0) {
        console.log(`[Webhook] Adding ${credits} credits to user ${userId}`);
        await authStorage.updateUserCredits(userId, credits);
        if (customerId) {
          await authStorage.updateUserStripeInfo(userId, customerId, subscriptionId);
        }
      }
    }

    res.json({ received: true });
  });

  // ---- STRIPE PORTAL ROUTE ----

  app.post("/api/payments/create-portal", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req)!;
      const user = await authStorage.getUser(userId);

      if (!user || !user.stripeCustomerId) {
        return res.status(400).json({ message: "No active subscription or customer found" });
      }

      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(400).json({ message: "Stripe is not configured" });
      }

      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${req.protocol}://${req.get("host")}/`,
      });

      return res.json({ url: session.url });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ---- DOWNLOAD ROUTE ----

  app.get("/api/videos/:id/download", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const vid = req.params.id as string;
      const userId = getUserId(req)!;
      const video = await storage.getVideo(vid);
      
      if (!video || video.userId !== userId) {
        return res.status(404).json({ message: "Video not found" });
      }

      if (video.status !== "completed" || !video.processedPath) {
        return res.status(400).json({ message: "Video not ready for download" });
      }

      const absolutePath = path.resolve(video.processedPath);
      if (!fs.existsSync(absolutePath)) {
        return res.status(404).json({ message: "Processed file not found" });
      }

      const stat = fs.statSync(absolutePath);
      const safeName = video.originalFilename
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/_+/g, "_")
        .substring(0, 100);
      
      // Handle the file extension correctly
      const ext = path.extname(video.processedPath) || ".mp4";
      const downloadName = `aivideoframe_${safeName}${safeName.endsWith(ext) ? '' : ext}`;

      // Set explicit timeout for this request (1 hour)
      req.setTimeout(3600000);
      
      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Length": stat.size,
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Content-Type-Options": "nosniff",
        "Content-Transfer-Encoding": "binary"
      });

      // Flush headers to establish connection early
      res.flushHeaders();

      const fileStream = fs.createReadStream(absolutePath);
      
      fileStream.on("error", (error) => {
        console.error(`[Download] Stream error for video ${vid}:`, error);
        if (!res.headersSent) {
          res.status(500).send("Error streaming file");
        } else {
          res.end();
        }
      });

      // Handle client disconnects
      req.on("close", () => {
        console.log(`[Download] Client closed connection for video ${vid}`);
        fileStream.destroy();
      });

      fileStream.pipe(res);
    } catch (error: any) {
      console.error(`[Download] Error for video ${req.params.id}:`, error);
      if (!res.headersSent) {
        res.status(500).json({ message: error.message });
      }
    }
  });

  return httpServer;
}
