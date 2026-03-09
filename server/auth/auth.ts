import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";

const OIDC_CACHE_MAX_AGE = 60 * 60 * 1000; // 1 hour
const OIDC_SCOPE = "openid email profile";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.AUTH_ISSUER_URL!),
      process.env.AUTH_CLIENT_ID!,
      process.env.AUTH_CLIENT_SECRET
    );
  },
  { maxAge: OIDC_CACHE_MAX_AGE }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    // Disable automatic table creation in production as it fails due to missing SQL files in the bundle.
    // The table has already been created manually.
    createTableIfMissing: false, 
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    name: "sid",
    cookie: {
      httpOnly: true,
      // Use secure cookies in production. Express will check the 'trust proxy' setting
      // to determine if the connection is secure.
      secure: process.env.NODE_ENV === "production",
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

export function getUserId(req: any): string | undefined {
  return req.user?.claims?.sub || req.user?.id;
}

export async function setupAuth(app: Express) {
  // Note: trust proxy is also set in server/index.ts for global effect
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
  // We prioritize AUTH_CALLBACK_URL from environment variables.
  let callbackURL = process.env.AUTH_CALLBACK_URL;

  if (!callbackURL) {
    const port = process.env.PORT || "5001";
    if (process.env.NODE_ENV === "production") {
      // RAILWAY_PUBLIC_DOMAIN is a good fallback for Railway if explicit AUTH_CALLBACK_URL is missing
      const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.APP_URL;
      if (domain) {
        const protocol = domain.startsWith("http") ? "" : "https://";
        callbackURL = `${protocol}${domain}/api/callback`;
      } else {
        // Last resort fallback
        callbackURL = `http://localhost:${port}/api/callback`;
      }
    } else {
      callbackURL = `http://localhost:${port}/api/callback`;
    }
  }

  console.log(`[Auth] Initializing OIDC strategy with callback URL: ${callbackURL}`);

  const strategy = new Strategy(
    {
      config,
      scope: OIDC_SCOPE,
      callbackURL,
    },
    verify
  );
  passport.use("oidc", strategy);

  app.get("/api/login", (req, res, next) => {
    passport.authenticate("oidc", {
      prompt: "select_account",
      scope: OIDC_SCOPE.split(" "),
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    console.log(`[Auth] Callback triggered. Query: ${JSON.stringify(req.query)}`);
    
    passport.authenticate("oidc", (err: any, user: any, info: any) => {
      if (err) {
        console.error("[Auth] Passport authenticate error:", err);
        // If it's a state mismatch or similar, logging the session state might help
        console.error("[Auth] Session during error:", JSON.stringify({
          id: req.sessionID,
          hasSession: !!req.session,
          passport: (req.session as any)?.passport
        }));
        return next(err);
      }
      if (!user) {
        console.error("[Auth] No user found in callback. Info:", JSON.stringify(info));
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
    return res.status(401).json({ message: "Session expired, please log in again" });
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    console.error("[Auth] Token refresh failed:", error);
    return res.status(401).json({ message: "Session expired, please log in again" });
  }
};
