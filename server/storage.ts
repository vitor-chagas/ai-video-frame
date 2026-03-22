import { 
  type Video, type InsertVideo, 
  type Payment, type InsertPayment,
  videos, payments 
} from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";
import fs from "fs";
import { promisify } from "util";

const unlinkAsync = promisify(fs.unlink);

export interface IStorage {
  getVideo(id: string): Promise<Video | undefined>;
  getVideosByUser(userId: string): Promise<Video[]>;
  createVideo(video: InsertVideo): Promise<Video>;
  updateVideoStatus(id: string, status: string, processedPath?: string): Promise<Video | undefined>;
  updateVideoSubtitles(id: string, detectedLanguage: string, subtitlePath: string): Promise<Video | undefined>;
  getAllProcessingVideos(): Promise<Video[]>;
  deleteVideo(id: string): Promise<void>;
  deleteAllUserVideos(userId: string): Promise<void>;
  deleteStaleUploadedVideos(maxAgeMs: number): Promise<Video[]>;

  getPayment(id: string): Promise<Payment | undefined>;
  getPaymentByVideoId(videoId: string): Promise<Payment | undefined>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePaymentStatus(id: string, status: string, stripeSessionId?: string): Promise<Payment | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getVideo(id: string): Promise<Video | undefined> {
    const [video] = await db.select().from(videos).where(eq(videos.id, id));
    return video;
  }

  async getVideosByUser(userId: string): Promise<Video[]> {
    return await db.select().from(videos).where(eq(videos.userId, userId));
  }

  async createVideo(insertVideo: InsertVideo): Promise<Video> {
    const [video] = await db.insert(videos).values(insertVideo).returning();
    return video;
  }

  async updateVideoStatus(id: string, status: string, processedPath?: string): Promise<Video | undefined> {
    const updateData: any = { status };
    if (processedPath) updateData.processedPath = processedPath;
    const [video] = await db.update(videos).set(updateData).where(eq(videos.id, id)).returning();
    return video;
  }

  async updateVideoSubtitles(id: string, detectedLanguage: string, subtitlePath: string): Promise<Video | undefined> {
    const [video] = await db.update(videos).set({ detectedLanguage, subtitlePath }).where(eq(videos.id, id)).returning();
    return video;
  }

  async getAllProcessingVideos(): Promise<Video[]> {
    return await db.select().from(videos).where(eq(videos.status, "processing"));
  }

  async deleteVideo(id: string): Promise<void> {
    await db.delete(videos).where(eq(videos.id, id));
  }

  async deleteAllUserVideos(userId: string): Promise<void> {
    await db.delete(videos).where(eq(videos.userId, userId));
  }

  async deleteStaleUploadedVideos(maxAgeMs: number): Promise<Video[]> {
    const allVideos = await db.select().from(videos).where(eq(videos.status, "uploaded"));
    const now = new Date();
    const staleVideos: Video[] = [];
    
    for (const video of allVideos) {
      const age = now.getTime() - new Date(video.createdAt || 0).getTime();
      if (age > maxAgeMs) {
        staleVideos.push(video);
        
        // Clean up physical files before deleting database record
        if (video.originalPath && fs.existsSync(video.originalPath)) {
          await unlinkAsync(video.originalPath).catch((err: any) => 
            console.error(`Failed to delete file ${video.originalPath}:`, err)
          );
        }
        if (video.processedPath && fs.existsSync(video.processedPath)) {
          await unlinkAsync(video.processedPath).catch((err: any) =>
            console.error(`Failed to delete file ${video.processedPath}:`, err)
          );
        }
        if (video.subtitlePath && fs.existsSync(video.subtitlePath)) {
          await unlinkAsync(video.subtitlePath).catch((err: any) =>
            console.error(`Failed to delete file ${video.subtitlePath}:`, err)
          );
        }

        await this.deleteVideo(video.id);
      }
    }
    
    return staleVideos;
  }

  async getPayment(id: string): Promise<Payment | undefined> {
    const [payment] = await db.select().from(payments).where(eq(payments.id, id));
    return payment;
  }

  async getPaymentByVideoId(videoId: string): Promise<Payment | undefined> {
    const [payment] = await db.select().from(payments).where(eq(payments.videoId, videoId));
    return payment;
  }

  async createPayment(insertPayment: InsertPayment): Promise<Payment> {
    const [payment] = await db.insert(payments).values(insertPayment).returning();
    return payment;
  }

  async updatePaymentStatus(id: string, status: string, stripeSessionId?: string): Promise<Payment | undefined> {
    const updateData: any = { status };
    if (stripeSessionId) updateData.stripeSessionId = stripeSessionId;
    const [payment] = await db.update(payments).set(updateData).where(eq(payments.id, id)).returning();
    return payment;
  }
}

export const storage = new DatabaseStorage();
