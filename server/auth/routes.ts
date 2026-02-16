import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./auth";
import { Resend } from "resend";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);

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
  app.post("/api/auth/magic-link", async (req, res) => {
    const { email } = req.body;
    if (!email || !email.includes("@")) {
      return res.status(400).json({ message: "Invalid email address" });
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
      const magicLink = `${protocol}://${host}/api/auth/verify?token=${token}`;

      console.log(`[Auth] Sending magic link to ${email}: ${magicLink}`);

      const { data, error } = await resend.emails.send({
        from: "App Auto Framer <onboarding@resend.dev>", // Default Resend test email
        to: email,
        subject: "Login to App Auto Framer",
        html: `<p>Click the link below to login to your account. This link expires in 15 minutes.</p><p><a href="${magicLink}">${magicLink}</a></p>`,
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

  // Verify magic link
  app.get("/api/auth/verify", async (req, res, next) => {
    const { token } = req.query;
    if (!token || typeof token !== "string") {
      return res.status(400).send("Invalid or missing token");
    }

    try {
      const verificationToken = await authStorage.getVerificationToken(token);
      if (!verificationToken) {
        return res.status(400).send("Invalid or expired token");
      }

      // Delete token after use
      await authStorage.deleteVerificationToken(token);

      // Find or create user
      let user = await authStorage.getUserByEmail(verificationToken.identifier);
      if (!user) {
        user = await authStorage.upsertUser({
          id: undefined as any, // Drizzle will generate a UUID
          email: verificationToken.identifier,
          credits: 5, // Give 5 free credits to new users
        });
      }

      // Log user in
      req.login(user, (err) => {
        if (err) {
          console.error("[Auth] Magic link login error:", err);
          return next(err);
        }
        console.log(`[Auth] User ${user!.id} logged in via magic link`);
        res.redirect("/");
      });
    } catch (error) {
      console.error("[Auth] Verification error:", error);
      res.status(500).send("An error occurred during verification");
    }
  });
}
