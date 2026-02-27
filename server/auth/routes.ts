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

      const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
        : `${protocol}://${host}`;

      const { data, error } = await resend.emails.send({
        from: "AI Video Frame <contact@aivideoframe.com>",
        to: email,
        subject: "Login to AI Video Frame",
        html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login to AI Video Frame</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9f6f1; color: #1a1512;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9f6f1;">
    <tr>
      <td align="center" style="padding: 40px 0 30px 0;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 0 0 30px 0;">
              <img src="${baseUrl}/logo.png" alt="AI Video Frame" width="180" style="display: block; border: 0;" />
            </td>
          </tr>
          <tr>
            <td style="background-color: #ffffff; padding: 40px; border-radius: 24px; border: 1px solid #e8e2d9; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding: 0 0 20px 0;">
                    <h1 style="margin: 0; font-family: 'Georgia', serif; font-size: 28px; line-height: 1.2; font-weight: bold; color: #1a1512;">
                      Magic link for your login.
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #5c554f;">
                    Click the button below to securely login to your AI Video Frame account. This link will expire in 15 minutes.
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
              &copy; 2026 AI Video Frame. All rights reserved.
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
          credits: 1, // Give 1 free credit to new users
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
