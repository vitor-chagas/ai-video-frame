import { vi } from "vitest";
import express, { type Express } from "express";
import { createServer, type Server } from "http";

// Set required env vars before any module imports
process.env.AUTH_ISSUER_URL = "https://accounts.google.com";
process.env.AUTH_CLIENT_ID = "test-client-id";
process.env.AUTH_CLIENT_SECRET = "test-client-secret";
process.env.SESSION_SECRET = "test-session-secret";

// Mock openid-client BEFORE any server module imports to prevent OIDC discovery network call
vi.mock("openid-client", async () => {
  const mockConfig = {
    issuer: "https://mock-issuer.example.com",
    authorization_endpoint: "https://mock-issuer.example.com/auth",
    end_session_endpoint: undefined,
  };
  return {
    discovery: vi.fn().mockResolvedValue(mockConfig),
    buildEndSessionUrl: vi.fn().mockReturnValue(new URL("https://mock-issuer.example.com/logout")),
    refreshTokenGrant: vi.fn().mockResolvedValue({}),
  };
});

// Mock openid-client/passport Strategy to avoid real OIDC setup
vi.mock("openid-client/passport", () => {
  class MockStrategy {
    name = "oidc";
    authenticate(_req: any, _options: any) {}
  }
  return { Strategy: MockStrategy };
});

// Mock connect-pg-simple to avoid PostgreSQL session store connection
vi.mock("connect-pg-simple", () => {
  return {
    default: () => {
      return class MockPgStore {
        on() {}
        get(_sid: string, cb: Function) {
          cb(null, null);
        }
        set(_sid: string, _session: any, cb: Function) {
          cb(null);
        }
        destroy(_sid: string, cb: Function) {
          cb(null);
        }
        regenerate(_req: any, cb: Function) {
          cb(null);
        }
      };
    },
  };
});

export async function createTestApp(): Promise<{ app: Express; httpServer: Server }> {
  const { registerRoutes } = await import("../../server/routes.ts");

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);

  return { app, httpServer };
}
