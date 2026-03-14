import multer from "multer";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import { execFile } from "child_process";
import { log } from "./index";

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

export function calculateRequiredCredits(durationInSeconds: number | null): number {
  if (durationInSeconds === null) return 1;
  if (durationInSeconds <= 300) return 1;
  const additionalSeconds = durationInSeconds - 300;
  return 1 + Math.ceil(additionalSeconds / 60);
}

export async function deleteVideoFiles(video: { originalPath?: string | null; processedPath?: string | null }) {
  if (video.originalPath && fs.existsSync(video.originalPath)) {
    await unlinkAsync(video.originalPath).catch(() => {});
  }
  if (video.processedPath && fs.existsSync(video.processedPath)) {
    await unlinkAsync(video.processedPath).catch(() => {});
  }
}
