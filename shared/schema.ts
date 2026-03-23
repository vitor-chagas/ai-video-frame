import { pgTable, text, varchar, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export * from "./models/auth";
import { users, verificationTokens } from "./models/auth";

export const videos = pgTable("videos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  originalFilename: text("original_filename").notNull(),
  originalPath: text("original_path").notNull(),
  processedPath: text("processed_path"),
  aspectRatio: text("aspect_ratio").notNull().default("9:16"),
  status: text("status").notNull().default("uploaded"),
  fileSize: integer("file_size").notNull(),
  duration: integer("duration"),
  subtitlesEnabled: boolean("subtitles_enabled").default(false).notNull(),
  subtitleLanguage: text("subtitle_language"),
  subtitleMode: text("subtitle_mode"),
  subtitlePath: text("subtitle_path"),
  detectedLanguage: text("detected_language"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  videoId: varchar("video_id").references(() => videos.id, { onDelete: "cascade" }).notNull(),
  stripeSessionId: text("stripe_session_id"),
  amount: integer("amount").notNull().default(500),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertVideoSchema = createInsertSchema(videos).pick({
  userId: true,
  originalFilename: true,
  originalPath: true,
  aspectRatio: true,
  fileSize: true,
  duration: true,
});

export const insertPaymentSchema = createInsertSchema(payments).pick({
  userId: true,
  videoId: true,
  stripeSessionId: true,
  amount: true,
});

export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videos.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof payments.$inferSelect;
