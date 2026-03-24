import { Router } from "express";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import { spawn } from "child_process";
import { rapidApiAuth, type RapidApiRequest } from "../../middleware/rapidapi";
import { storage } from "../../storage";
import { authStorage } from "../../auth/storage";
import {
  upload,
  getVideoDuration,
  videoProgress,
  deleteVideoFiles,
  calculateRequiredCredits,
  ALLOWED_RATIOS,
} from "../../video-processing";

const statAsync = promisify(fs.stat);

const router = Router();

// All v1 routes require RapidAPI auth
router.use(rapidApiAuth);


/**
 * POST /api/v1/videos/upload
 * Upload a video file for processing.
 * Body: multipart/form-data with `video` (file) and optional `aspectRatio` (string)
 */
router.post("/upload", upload.single("video"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No video file uploaded" });

    const aspectRatio = (req.body.aspectRatio as string) || "9:16";
    if (!ALLOWED_RATIOS.includes(aspectRatio)) {
      return res.status(400).json({ error: `Invalid aspectRatio. Allowed: ${ALLOWED_RATIOS.join(", ")}` });
    }

    const userId = (req as unknown as RapidApiRequest).rapidApiUser.id;
    const duration = await getVideoDuration(file.path);

    const video = await storage.createVideo({
      userId,
      originalFilename: file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_"),
      originalPath: file.path,
      aspectRatio,
      fileSize: file.size,
      duration,
    });

    return res.status(201).json({
      id: video.id,
      status: video.status,
      aspectRatio: video.aspectRatio,
      duration: video.duration,
      fileSize: video.fileSize,
      originalFilename: video.originalFilename,
      createdAt: video.createdAt,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/videos/:id/process
 * Start AI processing on an uploaded video.
 */
router.post("/:id/process", async (req, res) => {
  try {
    const videoId = req.params.id;
    const rapidApiUser = (req as unknown as RapidApiRequest).rapidApiUser;
    const userId = rapidApiUser.id;

    const video = await storage.getVideo(videoId);

    if (!video || video.userId !== userId) {
      return res.status(404).json({ error: "Video not found" });
    }
    if (video.status === "processing") {
      return res.status(400).json({ error: "Video is already being processed" });
    }
    if (video.status === "completed") {
      return res.status(400).json({ error: "Video has already been processed" });
    }

    const body = req.body ?? {};
    const subtitles = body.subtitles === true || body.subtitles === "true";
    const subtitleLanguage: string | null = body.subtitleLanguage || null;
    const subtitleMode: string = ["burn", "srt", "vtt"].includes(body.subtitleMode) ? body.subtitleMode : "burn";

    // RapidAPI: each credit = 1 unit deducted; subtitles cost +1 credit
    // For simplicity, decrement once for the video and once more for subtitles if enabled
    const updatedUser = await authStorage.decrementCreditsIfAvailable(userId);
    if (!updatedUser) {
      return res.status(402).json({ error: "Insufficient credits. Please upgrade your plan on RapidAPI." });
    }
    if (subtitles) {
      const userAfterFirst = await authStorage.decrementCreditsIfAvailable(userId);
      if (!userAfterFirst) {
        // Refund the first credit and reject
        await authStorage.updateUserCredits(userId, 1);
        return res.status(402).json({ error: "Insufficient credits for subtitles. You need 1 extra credit." });
      }
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

    pythonProcess.on("close", async (code) => {
      videoProgress.delete(video.id);
      if (code === 0) {
        await storage.updateVideoStatus(video.id, "completed", outputPath);
        if (subtitles && srtPath) {
          const langMatch = stdoutBuffer.match(/DetectedLanguage:\s*(\S+)/);
          const detectedLang = langMatch ? langMatch[1] : "unknown";
          await storage.updateVideoSubtitles(video.id, detectedLang, srtPath);
        }
      } else {
        await storage.updateVideoStatus(video.id, "failed");
      }
      // Clean up temp files left by Python script
      const tempFiles = fs.readdirSync(".").filter(f => f.startsWith("temp_no_audio_") && f.endsWith(".mp4"));
      for (const tmp of tempFiles) {
        try { fs.unlinkSync(tmp); } catch {}
      }
    });

    return res.json({ message: "Processing started", videoId: video.id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/videos/:id/status
 * Poll the processing status of a video.
 * Returns: { id, status, progress, aspectRatio, duration, fileSize, createdAt }
 */
router.get("/:id/status", async (req, res) => {
  try {
    const videoId = req.params.id;
    const userId = (req as unknown as RapidApiRequest).rapidApiUser.id;
    const video = await storage.getVideo(videoId);

    if (!video || video.userId !== userId) {
      return res.status(404).json({ error: "Video not found" });
    }

    const progress = videoProgress.get(videoId) ?? (video.status === "completed" ? 100 : 0);

    return res.json({
      id: video.id,
      status: video.status,
      progress,
      aspectRatio: video.aspectRatio,
      duration: video.duration,
      fileSize: video.fileSize,
      originalFilename: video.originalFilename,
      createdAt: video.createdAt,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/videos/:id/download
 * Download the processed video. Only available when status is "completed".
 */
router.get("/:id/download", async (req, res) => {
  try {
    const videoId = req.params.id;
    const userId = (req as unknown as RapidApiRequest).rapidApiUser.id;
    const video = await storage.getVideo(videoId);

    if (!video || video.userId !== userId) {
      return res.status(404).json({ error: "Video not found" });
    }
    if (video.status !== "completed" || !video.processedPath) {
      return res.status(400).json({ error: "Video is not ready for download", status: video.status });
    }

    const absolutePath = path.resolve(video.processedPath);
    const uploadsDir = path.resolve("./uploads");
    if (!absolutePath.startsWith(uploadsDir + path.sep) && absolutePath !== uploadsDir) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: "Processed file not found" });
    }

    const stat = await statAsync(absolutePath);
    const safeName = video.originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 100);
    const ext = path.extname(video.processedPath) || ".mp4";
    const downloadName = `aivideoframe_${safeName}${safeName.endsWith(ext) ? "" : ext}`;

    req.setTimeout(3600000);
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(absolutePath).pipe(res);
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/v1/videos/:id
 * Delete a video and its files.
 */
router.delete("/:id", async (req, res) => {
  try {
    const videoId = req.params.id;
    const userId = (req as unknown as RapidApiRequest).rapidApiUser.id;
    const video = await storage.getVideo(videoId);

    if (!video || video.userId !== userId) {
      return res.status(404).json({ error: "Video not found" });
    }

    await deleteVideoFiles(video);
    await storage.deleteVideo(videoId);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
