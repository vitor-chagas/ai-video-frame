import multer from "multer";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import { execFile } from "child_process";
import { log } from "./utils/logger";

const execFileAsync = promisify(execFile);
export const unlinkAsync = promisify(fs.unlink);

export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
export const ALLOWED_RATIOS = ["9:16", "1:1", "4:5", "16:9", "2:3"];

// Shared progress map — used by both web app routes and v1 API routes
export const videoProgress: Map<string, number> = new Map();

export const upload = multer({
  dest: "uploads/input/",
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowedExts = [".mp4", ".mov", ".avi"];
    const allowedMimeTypes = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/avi"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext) && allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only MP4, MOV, and AVI files are allowed"));
    }
  },
});

export async function getVideoResolution(filePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0",
      filePath,
    ]);
    const [w, h] = stdout.trim().split(",").map(Number);
    if (isNaN(w) || isNaN(h)) return null;
    return { width: w, height: h };
  } catch (error) {
    console.error("Error getting video resolution:", error);
    return null;
  }
}

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;

export async function downscaleIfNeeded(filePath: string): Promise<void> {
  const resolution = await getVideoResolution(filePath);
  if (!resolution) return;

  if (resolution.width <= MAX_WIDTH && resolution.height <= MAX_HEIGHT) return;

  log(`Downscaling ${filePath} from ${resolution.width}x${resolution.height} to max ${MAX_WIDTH}x${MAX_HEIGHT}`, "FFmpeg");

  const tmpOutput = filePath + ".downscaled.mp4";
  try {
    await execFileAsync("ffmpeg", [
      "-i", filePath,
      "-vf", `scale='min(${MAX_WIDTH},iw)':'min(${MAX_HEIGHT},ih)':force_original_aspect_ratio=decrease`,
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-c:a", "copy",
      "-y", tmpOutput,
    ], { maxBuffer: 50 * 1024 * 1024, timeout: 5 * 60 * 1000 });

    await unlinkAsync(filePath);
    await promisify(fs.rename)(tmpOutput, filePath);
    log(`Downscaled ${filePath} successfully`, "FFmpeg");
  } catch (error) {
    // Clean up temp file if it exists
    if (fs.existsSync(tmpOutput)) {
      await unlinkAsync(tmpOutput).catch(() => {});
    }
    console.error("Error downscaling video:", error);
    throw new Error("Video resolution exceeds 1080p and automatic downscaling failed. Please upload a video with a maximum resolution of 1080p.");
  }
}

export async function getVideoDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-select_streams", "v:0",
      "-show_entries", "stream=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let duration = parseFloat(stdout.trim());

    if (isNaN(duration)) {
      const { stdout: stdoutFormat } = await execFileAsync("ffprobe", [
        "-v", "quiet",
        "-analyzeduration", "1000000",
        "-probesize", "1000000",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        filePath,
      ]);
      duration = parseFloat(stdoutFormat.trim());
    }

    log(`Duration for ${filePath}: ${duration}s`, "FFprobe");
    return isNaN(duration) ? null : Math.round(duration);
  } catch (error) {
    console.error("Error getting video duration:", error);
    return null;
  }
}

export function calculateRequiredCredits(durationInSeconds: number | null, withSubtitles: boolean = false): number {
  if (durationInSeconds === null) return withSubtitles ? 2 : 1;
  if (durationInSeconds <= 300) return withSubtitles ? 2 : 1;
  const additionalSeconds = durationInSeconds - 300;
  const base = 1 + Math.ceil(additionalSeconds / 60);
  return withSubtitles ? base + 1 : base;
}

export async function deleteVideoFiles(video: { originalPath?: string | null; processedPath?: string | null; subtitlePath?: string | null }) {
  if (video.originalPath && fs.existsSync(video.originalPath)) {
    await unlinkAsync(video.originalPath).catch(() => {});
  }
  if (video.processedPath && fs.existsSync(video.processedPath)) {
    await unlinkAsync(video.processedPath).catch(() => {});
  }
  if (video.subtitlePath && fs.existsSync(video.subtitlePath)) {
    await unlinkAsync(video.subtitlePath).catch(() => {});
  }
}
