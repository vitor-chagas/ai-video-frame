import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.AUTH_ISSUER_URL!),
      process.env.AUTH_CLIENT_ID!,
      process.env.AUTH_CLIENT_SECRET
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true, // Changed to true to automatically create the session table
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: true, // Force session to be saved back to the session store
    saveUninitialized: true, // Force a session that is "new" but not modified to be saved to the store
    name: "sid",
    cookie: {
      httpOnly: true,
      // Force secure to false for local debugging on HTTP
      secure: false,
      maxAge: sessionTtl,
      sameSite: "lax",
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  const claims = tokens.claims();
  if (!claims) throw new Error("No claims found in token");
  user.id = claims.sub;
  user.claims = claims;
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = claims.exp;
}
async function upsertUser(claims: any) {
  return await authStorage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["given_name"] || claims["first_name"],
    lastName: claims["family_name"] || claims["last_name"],
    profileImageUrl: claims["picture"] || claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    try {
      const claims = tokens.claims();
      if (!claims) throw new Error("No claims found in token");
      console.log(`[Auth] Verify successful for user: ${claims.email || claims.sub}`);
      const user = await upsertUser(claims);
      const sessionUser = {
        id: user.id,
        claims: claims,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: claims.exp,
      };
      verified(null, sessionUser);
    } catch (error) {
      console.error("[Auth] Verify error:", error);
      verified(error);
    }
  };

  passport.serializeUser((user: any, cb) => {
    console.log(`[Auth] Serializing user: ${user.id}`);
    cb(null, user.id);
  });

  passport.deserializeUser(async (id: string, cb) => {
    try {
      console.log(`[Auth] Deserializing user: ${id}`);
      const user = await authStorage.getUser(id);
      if (!user) {
        console.log(`[Auth] User ${id} not found in database during deserialization`);
      }
      cb(null, user);
    } catch (error) {
      console.error(`[Auth] Deserialization error for user ${id}:`, error);
      cb(error);
    }
  });

  // Initialize strategy once and persist it. 
  // Re-creating it inside routes causes OIDC state verification to fail.
  const callbackURL = process.env.AUTH_CALLBACK_URL || (process.env.NODE_ENV === "production" 
    ? "http://localhost:5001/api/callback" // Fallback for local docker testing
    : "http://localhost:5000/api/callback");

  console.log(`[Auth] Using callback URL: ${callbackURL}`);

  const strategy = new Strategy(
    {
      config,
      scope: "openid email profile",
      callbackURL,
    },
    verify
  );
  passport.use("oidc", strategy);

  app.get("/api/login", (req, res, next) => {
    passport.authenticate("oidc", {
      prompt: "login consent",
      scope: ["openid", "email", "profile"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    console.log(`[Auth] Callback triggered`);
    
    passport.authenticate("oidc", (err: any, user: any, info: any) => {
      if (err) {
        console.error("[Auth] Passport authenticate error:", err);
        return next(err);
      }
      if (!user) {
        console.error("[Auth] No user found in callback:", info);
        return res.redirect("/api/login");
      }
      req.login(user, (loginErr) => {
        if (loginErr) {
          console.error("[Auth] req.login error:", loginErr);
          return next(loginErr);
        }
        console.log(`[Auth] User ${user.id} logged in successfully, session established`);
        res.redirect("/");
      });
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      // Google doesn't always support end_session_endpoint via OIDC discovery
      if ((config as any).end_session_endpoint) {
        const endSessionUrl = client.buildEndSessionUrl(config, {
          client_id: process.env.AUTH_CLIENT_ID!,
          post_logout_redirect_uri: process.env.AUTH_LOGOUT_REDIRECT_URL || `${req.protocol}://${req.get("host")}`,
        });
        return res.redirect(endSessionUrl.href);
      }

      // Fallback if no end_session_endpoint is found
      res.redirect("/");
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = req.user as any;

  // Only perform token refresh if expires_at is available.
  // When users are deserialized from the DB, these OIDC-specific fields might be missing.
  if (!user?.expires_at) {
    return next();
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    // If token is expired but we have no refresh token, we still let them through
    // as long as the session itself is valid. We could alternatively force a re-login.
    return next();
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    console.error("[Auth] Token refresh failed:", error);
    // If refresh fails, we still allow the request if the session is alive,
    // or we could redirect to login. For now, let's be lenient.
    return next();
  }
};
