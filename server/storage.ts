import { 
  type Video, type InsertVideo, 
  type Payment, type InsertPayment,
  videos, payments 
} from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  getVideo(id: string): Promise<Video | undefined>;
  getVideosByUser(userId: string): Promise<Video[]>;
  createVideo(video: InsertVideo): Promise<Video>;
  updateVideoStatus(id: string, status: string, processedPath?: string): Promise<Video | undefined>;
  getAllProcessingVideos(): Promise<Video[]>;

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

  async getAllProcessingVideos(): Promise<Video[]> {
    return await db.select().from(videos).where(eq(videos.status, "processing"));
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
