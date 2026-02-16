import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./auth";
import multer from "multer";
import path from "path";
import { spawn } from "child_process";
import fs from "fs";

const videoProgress: Map<string, number> = new Map();

const upload = multer({
  dest: "uploads/input/",
  limits: { fileSize: 500 * 1024 * 1024 },
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
      const aspectRatio = req.body.aspectRatio || "9:16";
      const video = await storage.createVideo({
        userId,
        originalFilename: file.originalname,
        originalPath: file.path,
        aspectRatio,
        fileSize: file.size,
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

  app.post("/api/payments/create", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { videoId } = req.body;
      if (!videoId) {
        return res.status(400).json({ message: "videoId is required" });
      }

      const userId = getUserId(req)!;
      const video = await storage.getVideo(videoId);
      if (!video || video.userId !== userId) {
        return res.status(404).json({ message: "Video not found" });
      }

      const existingPayment = await storage.getPaymentByVideoId(videoId);
      if (existingPayment && existingPayment.status === "completed") {
        return res.status(400).json({ message: "Video already paid for" });
      }

      if (!process.env.STRIPE_SECRET_KEY) {
        const payment = await storage.createPayment({
          userId,
          videoId,
          amount: 500,
          stripeSessionId: "dev_simulated_" + Date.now(),
        });
        await storage.updatePaymentStatus(payment.id, "completed");
        return res.json({ paymentId: payment.id, status: "completed", simulated: true });
      }

      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "AutoFrame Video Processing",
                description: `Process "${video.originalFilename}" to ${video.aspectRatio}`,
              },
              unit_amount: 500,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${req.protocol}://${req.get("host")}/?payment=success&videoId=${videoId}`,
        cancel_url: `${req.protocol}://${req.get("host")}/?payment=cancelled`,
      });

      const payment = await storage.createPayment({
        userId,
        videoId,
        amount: 500,
        stripeSessionId: session.id,
      });

      return res.json({ paymentId: payment.id, checkoutUrl: session.url });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ---- STRIPE PAYMENT CONFIRMATION (after redirect) ----

  app.post("/api/payments/confirm", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { videoId } = req.body;
      if (!videoId) {
        return res.status(400).json({ message: "videoId is required" });
      }

      const userId = getUserId(req)!;
      const video = await storage.getVideo(videoId);
      if (!video || video.userId !== userId) {
        return res.status(404).json({ message: "Video not found" });
      }

      const payment = await storage.getPaymentByVideoId(videoId);
      if (!payment) {
        return res.status(404).json({ message: "Payment not found" });
      }

      if (payment.status === "completed") {
        return res.json({ status: "completed", paymentId: payment.id });
      }

      if (process.env.STRIPE_SECRET_KEY && payment.stripeSessionId && !payment.stripeSessionId.startsWith("dev_")) {
        const Stripe = (await import("stripe")).default;
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const stripeSession = await stripe.checkout.sessions.retrieve(payment.stripeSessionId);

        if (stripeSession.payment_status === "paid") {
          await storage.updatePaymentStatus(payment.id, "completed");
          return res.json({ status: "completed", paymentId: payment.id });
        } else {
          return res.json({ status: "pending", paymentId: payment.id });
        }
      }

      return res.json({ status: payment.status, paymentId: payment.id });
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

      const payment = await storage.getPaymentByVideoId(video.id);
      if (!payment || payment.status !== "completed") {
        return res.status(402).json({ message: "Payment required before processing" });
      }

      if (video.status === "processing") {
        return res.status(400).json({ message: "Video is already being processed" });
      }

      if (video.status === "completed") {
        return res.status(400).json({ message: "Video has already been processed" });
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
        console.log(`[AutoFrame] ${output}`);
        const match = output.match(/Progress:\s*([\d.]+)%/);
        if (match) {
          videoProgress.set(video.id, parseFloat(match[1]));
        }
      });

      pythonProcess.stderr.on("data", (data) => {
        console.error(`[AutoFrame Error] ${data}`);
      });

      pythonProcess.on("close", async (code) => {
        videoProgress.delete(video.id);
        if (code === 0) {
          await storage.updateVideoStatus(video.id, "completed", outputPath);
          console.log(`[AutoFrame] Processing complete for video ${video.id}`);
        } else {
          await storage.updateVideoStatus(video.id, "failed");
          console.error(`[AutoFrame] Processing failed for video ${video.id} with code ${code}`);
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

  // ---- DOWNLOAD ROUTE ----

  app.get("/api/videos/:id/download", isAuthenticated, async (req: Request, res: Response) => {
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

    const safeName = video.originalFilename
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .substring(0, 100);
    const downloadName = `autoframe_${safeName}`;
    const stat = fs.statSync(absolutePath);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
    const fileStream = fs.createReadStream(absolutePath);
    fileStream.pipe(res);
  });

  return httpServer;
}
