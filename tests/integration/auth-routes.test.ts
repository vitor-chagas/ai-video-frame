import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { authStorage } from "../../server/auth/storage.ts";

// Mock storage to avoid real database calls
vi.mock("../../server/storage.ts", () => ({
  storage: {
    getVideosByUser: vi.fn().mockResolvedValue([]),
    getAllProcessingVideos: vi.fn().mockResolvedValue([]),
    deleteStaleUploadedVideos: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../server/auth/storage.ts", () => ({
  authStorage: {
    getUser: vi.fn().mockResolvedValue(null),
    getUserByEmail: vi.fn().mockResolvedValue(null),
    upsertUser: vi.fn().mockResolvedValue({ id: "user-id", email: "test@test.com" }),
    createVerificationToken: vi.fn().mockResolvedValue({}),
    getVerificationToken: vi.fn().mockResolvedValue(null),
    deleteVerificationToken: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock Resend to avoid sending real emails (Resend is instantiated at module level in auth/routes.ts)
vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = {
      send: vi.fn().mockResolvedValue({ data: { id: "mock-email-id" }, error: null }),
    };
  },
}));

let app: Express;

beforeAll(async () => {
  const { createTestApp } = await import("./setup.ts");
  ({ app } = await createTestApp());
});

const VALID_TOKEN = "a".repeat(64);

describe("POST /api/auth/magic-link — input validation", () => {
  it("returns 400 for missing email", async () => {
    const res = await request(app).post("/api/auth/magic-link").send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid email/i);
  });

  it("returns 400 for malformed email (no @)", async () => {
    const res = await request(app)
      .post("/api/auth/magic-link")
      .send({ email: "notanemail" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid email/i);
  });

  it("returns 400 for email without domain part", async () => {
    const res = await request(app)
      .post("/api/auth/magic-link")
      .send({ email: "user@" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a known disposable domain", async () => {
    const res = await request(app)
      .post("/api/auth/magic-link")
      .send({ email: "user@mailinator.com" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/disposable/i);
  });

  it("returns 200 for a valid non-disposable email", async () => {
    const res = await request(app)
      .post("/api/auth/magic-link")
      .send({ email: "user@gmail.com" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/magic link sent/i);
  });
});

describe("POST /api/auth/verify — error cases", () => {
  it("returns 400 for missing token", async () => {
    const res = await request(app).post("/api/auth/verify").send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or missing token/i);
  });

  it("returns 400 for a token not found in the database", async () => {
    const res = await request(app)
      .post("/api/auth/verify")
      .send({ token: "nonexistent-token" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired token/i);
  });
});

describe("POST /api/auth/verify — happy path", () => {
  it("returns 200 and logs in an existing user", async () => {
    vi.mocked(authStorage.getVerificationToken).mockResolvedValueOnce({
      id: "token-id",
      identifier: "user@gmail.com",
      token: VALID_TOKEN,
      expires: new Date(Date.now() + 15 * 60 * 1000),
      createdAt: new Date(),
    });
    vi.mocked(authStorage.getUserByEmail).mockResolvedValueOnce({
      id: "existing-user-id",
      email: "user@gmail.com",
      firstName: null,
      lastName: null,
      profileImageUrl: null,
      credits: 5,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      rapidApiUserId: null,
      rapidApiSubscription: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post("/api/auth/verify")
      .send({ token: VALID_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("creates a new user with 2 credits when user does not exist", async () => {
    vi.mocked(authStorage.getVerificationToken).mockResolvedValueOnce({
      id: "token-id",
      identifier: "newuser@gmail.com",
      token: VALID_TOKEN,
      expires: new Date(Date.now() + 15 * 60 * 1000),
      createdAt: new Date(),
    });

    const res = await request(app)
      .post("/api/auth/verify")
      .send({ token: VALID_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(vi.mocked(authStorage.upsertUser)).toHaveBeenCalledWith(
      expect.objectContaining({ credits: 2 })
    );
  });

  it("deletes the token after successful verification", async () => {
    vi.mocked(authStorage.getVerificationToken).mockResolvedValueOnce({
      id: "token-id",
      identifier: "user@gmail.com",
      token: VALID_TOKEN,
      expires: new Date(Date.now() + 15 * 60 * 1000),
      createdAt: new Date(),
    });
    vi.mocked(authStorage.deleteVerificationToken).mockClear();

    await request(app)
      .post("/api/auth/verify")
      .send({ token: VALID_TOKEN });

    expect(vi.mocked(authStorage.deleteVerificationToken)).toHaveBeenCalledWith(VALID_TOKEN);
  });
});
