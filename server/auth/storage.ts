import { users, verificationTokens, type User, type UpsertUser, type VerificationToken, type InsertVerificationToken } from "@shared/models/auth";
import { db } from "../db";
import { eq, and, gt, sql } from "drizzle-orm";

const RAPIDAPI_PLAN_CREDITS: Record<string, number> = {
  BASIC: 1,
  PRO: 20,
  ULTRA: 50,
};

// Interface for auth storage operations
export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserCredits(id: string, amount: number): Promise<User | undefined>;
  decrementCreditsIfAvailable(id: string): Promise<User | null>;
  updateUserStripeInfo(id: string, customerId: string, subscriptionId?: string): Promise<User | undefined>;
  createVerificationToken(token: InsertVerificationToken): Promise<VerificationToken>;
  getVerificationToken(token: string): Promise<VerificationToken | undefined>;
  deleteVerificationToken(token: string): Promise<void>;
  findOrCreateRapidApiUser(rapidApiUserId: string, subscription?: string): Promise<User>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async updateUserCredits(id: string, amount: number): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set({
        credits: sql`${users.credits} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return updatedUser;
  }

  async decrementCreditsIfAvailable(id: string): Promise<User | null> {
    const [updated] = await db
      .update(users)
      .set({
        credits: sql`${users.credits} - 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, id), gt(users.credits, 0)))
      .returning();
    return updated ?? null;
  }

  async updateUserStripeInfo(id: string, customerId: string, subscriptionId?: string): Promise<User | undefined> {
    const updateData: any = {
      stripeCustomerId: customerId,
      updatedAt: new Date(),
    };
    if (subscriptionId) {
      updateData.stripeSubscriptionId = subscriptionId;
    }
    
    const [updatedUser] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning();
    return updatedUser;
  }

  async createVerificationToken(tokenData: InsertVerificationToken): Promise<VerificationToken> {
    const [token] = await db.insert(verificationTokens).values(tokenData).returning();
    return token;
  }

  async getVerificationToken(token: string): Promise<VerificationToken | undefined> {
    const [tokenData] = await db
      .select()
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.token, token),
          gt(verificationTokens.expires, new Date())
        )
      );
    return tokenData;
  }

  async deleteVerificationToken(token: string): Promise<void> {
    await db.delete(verificationTokens).where(eq(verificationTokens.token, token));
  }

  async findOrCreateRapidApiUser(rapidApiUserId: string, subscription?: string): Promise<User> {
    const plan = subscription?.toUpperCase() ?? null;
    const credits = RAPIDAPI_PLAN_CREDITS[plan ?? ""] ?? 1;

    const [existing] = await db.select().from(users).where(eq(users.rapidApiUserId, rapidApiUserId));
    if (existing) {
      if (existing.rapidApiSubscription !== plan) {
        const [updated] = await db
          .update(users)
          .set({ rapidApiSubscription: plan, credits, updatedAt: new Date() })
          .where(eq(users.rapidApiUserId, rapidApiUserId))
          .returning();
        return updated;
      }
      return existing;
    }

    const [created] = await db
      .insert(users)
      .values({ rapidApiUserId, rapidApiSubscription: plan, credits })
      .returning();
    return created;
  }
}

export const authStorage = new AuthStorage();
