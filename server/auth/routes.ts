import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated, getUserId } from "./auth";
import { cleanupUserFiles } from "../routes";
import { log } from "../utils/logger";
import { Resend } from "resend";
import jwt from "jsonwebtoken";
import { randomBytes, timingSafeEqual } from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);

import { rateLimit } from "express-rate-limit";
import disposableDomains from "disposable-email-domains";

const magicLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: { message: "Too many magic link requests, please try again after 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

const magicLinkEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // max 3 magic links per email address per hour
  keyGenerator: (req) => (req.body?.email ?? "").toLowerCase(),
  message: { message: "Too many magic link requests for this email, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims?.sub || req.user.id;
      const user = await authStorage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Request a magic link
  app.post("/api/auth/magic-link", magicLinkLimiter, magicLinkEmailLimiter, async (req, res) => {
    const { email } = req.body;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email address" });
    }

    const domain = email.split("@")[1].toLowerCase();
    if ((disposableDomains as string[]).includes(domain)) {
      return res.status(400).json({ message: "Disposable email addresses are not allowed. Please use a permanent email." });
    }

    try {
      const token = randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await authStorage.createVerificationToken({
        identifier: email,
        token,
        expires,
      });

      const protocol = req.secure ? "https" : "http";
      const host = req.get("host");

      const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : `${protocol}://${host}`;

      const magicLink = `${baseUrl}/auth/verify?token=${token}`;

      const { data, error } = await resend.emails.send({
        from: "AI Video Frame <contact@aivideoframe.com>",
        to: email,
        subject: "Your sign-in link for AI Video Frame",
        text: `Sign in to AI Video Frame\n\nClick the link below to sign in. This link expires in 15 minutes.\n\n${magicLink}\n\nIf you didn't request this, you can safely ignore this email.\n\n© 2026 AI Video Frame`,
        html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to AI Video Frame</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9f6f1; color: #1a1512;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9f6f1;">
    <tr>
      <td align="center" style="padding: 40px 0 30px 0;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 0 0 30px 0;">
              <p style="margin: 0; font-family: 'Georgia', serif; font-size: 22px; font-weight: bold; color: #1a1512; letter-spacing: -0.5px;">AI Video Frame</p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #ffffff; padding: 40px; border-radius: 24px; border: 1px solid #e8e2d9; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding: 0 0 20px 0;">
                    <h1 style="margin: 0; font-family: 'Georgia', serif; font-size: 28px; line-height: 1.2; font-weight: bold; color: #1a1512;">
                      Your sign-in link.
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #5c554f;">
                    Click the button below to securely sign in to your AI Video Frame account. This link will expire in 15 minutes.
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <table border="0" cellpadding="0" cellspacing="0" style="border-collapse: separate;">
                      <tr>
                        <td align="center" style="border-radius: 100px; background-color: #1a1512;">
                          <a href="${magicLink}" target="_blank" style="display: inline-block; padding: 16px 40px; font-size: 16px; font-weight: 600; color: #f9f6f1; text-decoration: none; border-radius: 100px;">
                            Sign In to App
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px 40px; text-align: center; font-size: 12px; color: #8c857f;">
              &copy; 2026 AI Video Frame. All rights reserved.<br>If you didn't request this email, you can safely ignore it.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
        `,
      });

      if (error) {
        console.error("[Auth] Resend error:", error);
        return res.status(500).json({ message: "Failed to send email" });
      }

      res.json({ message: "Magic link sent! Check your email." });
    } catch (error) {
      console.error("[Auth] Magic link error:", error);
      res.status(500).json({ message: "An error occurred" });
    }
  });

  // Logout route
  app.post("/api/auth/logout", async (req, res, next) => {
    const userId = getUserId(req);
    if (userId) {
      // Cleanup files on logout to save storage
      await cleanupUserFiles(userId);
    }
    req.logout((err) => {
      if (err) return next(err);
      res.json({ message: "Logged out successfully" });
    });
  });

  // Verify magic link — POST so email pre-fetchers (which only do GET) can't consume the token
  app.post("/api/auth/verify", async (req, res, next) => {
    const { token: providedToken } = req.body;
    if (!providedToken || typeof providedToken !== "string") {
      return res.status(400).json({ message: "Invalid or missing token" });
    }

    try {
      const verificationToken = await authStorage.getVerificationToken(providedToken);

      if (!verificationToken) {
        return res.status(400).json({ message: "Invalid or expired token" });
      }

      // Timing-safe comparison
      const providedBuffer = Buffer.from(providedToken);
      const storedBuffer = Buffer.from(verificationToken.token);

      if (providedBuffer.length !== storedBuffer.length || !timingSafeEqual(providedBuffer, storedBuffer)) {
        return res.status(400).json({ message: "Invalid or expired token" });
      }

      await authStorage.deleteVerificationToken(providedToken);

      // Find or create user
      let user = await authStorage.getUserByEmail(verificationToken.identifier);
      if (!user) {
        user = await authStorage.upsertUser({
          id: undefined as any, // Drizzle will generate a UUID
          email: verificationToken.identifier,
          credits: 2, // Give 2 free credits to new users
        });
      }

      // Log user in
      req.login(user, (err) => {
        if (err) {
          console.error("[Auth] Magic link login error:", err);
          return next(err);
        }
        log(`User ${user!.id} logged in via magic link`, "Auth");
        res.json({ success: true });
      });
    } catch (error) {
      console.error("[Auth] Verification error:", error);
      res.status(500).json({ message: "An error occurred during verification" });
    }
  });
}
