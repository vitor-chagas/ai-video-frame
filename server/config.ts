import "dotenv/config";

const isProd = process.env.NODE_ENV === "production";
const p = (dev: string, prod: string) =>
  isProd ? process.env[prod] : process.env[dev];

export const config = {
  DATABASE_URL:             p("DEV_DATABASE_URL",              "PROD_DATABASE_URL")!,
  SESSION_SECRET:           p("DEV_SESSION_SECRET",            "PROD_SESSION_SECRET")!,
  SUPABASE_URL:             p("DEV_SUPABASE_URL",              "PROD_SUPABASE_URL")!,
  SUPABASE_PUB_KEY:         p("DEV_SUPABASE_PUB_KEY",          "PROD_SUPABASE_PUB_KEY")!,
  STRIPE_SECRET_KEY:        p("DEV_STRIPE_SECRET_KEY",         "PROD_STRIPE_SECRET_KEY")!,
  STRIPE_PUBLISHABLE_KEY:   p("DEV_STRIPE_PUBLISHABLE_KEY",    "PROD_STRIPE_PUBLISHABLE_KEY")!,
  STRIPE_PRICE_SINGLE:      p("DEV_STRIPE_PRICE_SINGLE",       "PROD_STRIPE_PRICE_SINGLE")!,
  STRIPE_PRICE_MONTHLY:     p("DEV_STRIPE_PRICE_MONTHLY",      "PROD_STRIPE_PRICE_MONTHLY")!,
  STRIPE_PRICE_YEARLY:      p("DEV_STRIPE_PRICE_YEARLY",       "PROD_STRIPE_PRICE_YEARLY")!,
  STRIPE_WEBHOOK_SECRET:    p("DEV_STRIPE_WEBHOOK_SECRET",     "PROD_STRIPE_WEBHOOK_SECRET")!,
  AUTH_ISSUER_URL:          process.env.AUTH_ISSUER_URL!,
  AUTH_CLIENT_ID:           p("DEV_AUTH_CLIENT_ID",            "PROD_AUTH_CLIENT_ID")!,
  AUTH_CLIENT_SECRET:       p("DEV_AUTH_CLIENT_SECRET",        "PROD_AUTH_CLIENT_SECRET")!,
  AUTH_CALLBACK_URL:        p("DEV_AUTH_CALLBACK_URL",         "PROD_AUTH_CALLBACK_URL"),
  AUTH_LOGOUT_REDIRECT_URL: p("DEV_AUTH_LOGOUT_REDIRECT_URL",  "PROD_AUTH_LOGOUT_REDIRECT_URL"),
  PORT:                     Number(p("DEV_PORT", "PROD_PORT")) || 5002,
  RESEND_API_KEY:           process.env.RESEND_API_KEY!,
  RAPIDAPI_PROXY_SECRET:    process.env.RAPIDAPI_PROXY_SECRET!,
  OPENAI_API_KEY:           process.env.OPENAI_API_KEY!,
  VITE_POSTHOG_API_KEY:     process.env.VITE_POSTHOG_API_KEY!,
  NODE_ENV:                 process.env.NODE_ENV ?? "development",
};
