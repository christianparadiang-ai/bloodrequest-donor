import { z } from "zod";

/**
 * Public environment variables accessible from browser and server.
 * Only variables with NEXT_PUBLIC_ prefix should be exposed.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().default("/sign-in"),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().default("/sign-up"),
  NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: z.string().default("/dashboard"),
  NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: z.string().default("/dashboard"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
});

/**
 * Server-only private environment variables.
 * NEVER exposed to client browser code.
 */
const serverEnvSchema = publicEnvSchema.extend({
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_WEBHOOK_SECRET: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  WORKER_SECRET: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
});

/**
 * Resolves the Supabase public key, supporting both legacy anon key
 * and modern publishable key formats (sb_publishable_...).
 * Returns undefined if neither is configured or if only placeholder values exist.
 */
export function getSupabasePublicKey(): string | undefined {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  const isReal = (k?: string) => Boolean(k && !k.includes("your_") && !k.includes("your-") && k.length > 0);

  if (isReal(anonKey)) return anonKey;
  if (isReal(pubKey)) return pubKey;
  return undefined;
}

export interface SupabasePublicConfigStatus {
  isConfigured: boolean;
  hasUrl: boolean;
  hasKey: boolean;
  keySource: "ANON_KEY" | "PUBLISHABLE_KEY" | "NONE";
  error?: string;
}

/**
 * Safely inspects Supabase public configuration and returns a diagnostic status
 * WITHOUT printing or exposing credential values.
 */
export function validateSupabasePublicConfig(): SupabasePublicConfigStatus {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  const isReal = (k?: string) => Boolean(k && !k.includes("your_") && !k.includes("your-") && k.length > 0);
  const isValidUrl = (u?: string) => {
    if (!u || u.includes("your_") || u.includes("your-")) return false;
    try {
      const parsed = new URL(u);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  };

  const hasUrl = isValidUrl(url);
  const hasAnon = isReal(anonKey);
  const hasPub = isReal(pubKey);

  if (!hasUrl && !hasAnon && !hasPub) {
    return {
      isConfigured: false,
      hasUrl: false,
      hasKey: false,
      keySource: "NONE",
      error: "Supabase URL and API Key are unconfigured.",
    };
  }

  if (!hasUrl) {
    return {
      isConfigured: false,
      hasUrl: false,
      hasKey: hasAnon || hasPub,
      keySource: hasAnon ? "ANON_KEY" : hasPub ? "PUBLISHABLE_KEY" : "NONE",
      error: "NEXT_PUBLIC_SUPABASE_URL is missing, invalid, or placeholder.",
    };
  }

  if (!hasAnon && !hasPub) {
    return {
      isConfigured: false,
      hasUrl: true,
      hasKey: false,
      keySource: "NONE",
      error: "Neither NEXT_PUBLIC_SUPABASE_ANON_KEY nor NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is configured.",
    };
  }

  return {
    isConfigured: true,
    hasUrl: true,
    hasKey: true,
    keySource: hasAnon ? "ANON_KEY" : "PUBLISHABLE_KEY",
  };
}

function getPublicEnv() {
  const resolvedAnonKey = getSupabasePublicKey();
  return publicEnvSchema.parse({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in",
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "/sign-up",
    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL || "/dashboard",
    NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL || "/dashboard",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: resolvedAnonKey,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

function getServerEnv() {
  if (typeof window !== "undefined") {
    throw new Error(
      "SECURITY CRITICAL: Attempted to access server-only environment variables in client browser!"
    );
  }

  return serverEnvSchema.parse({
    ...getPublicEnv(),
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    CLERK_WEBHOOK_SECRET: process.env.CLERK_WEBHOOK_SECRET,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    WORKER_SECRET: process.env.WORKER_SECRET,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
  });
}

export const env = {
  public: getPublicEnv(),
  get server() {
    return getServerEnv();
  },
  isSupabaseConfigured(): boolean {
    const key = getSupabasePublicKey();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url || !key) return false;
    if (url.includes("your_") || url.includes("your-")) return false;
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },
  isClerkConfigured(): boolean {
    return !!(
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      process.env.CLERK_SECRET_KEY
    );
  },
  isUpstashConfigured(): boolean {
    return !!(
      process.env.UPSTASH_REDIS_REST_URL &&
      process.env.UPSTASH_REDIS_REST_TOKEN
    );
  },
  isResendConfigured(): boolean {
    return !!process.env.RESEND_API_KEY;
  },
  isTwilioConfigured(): boolean {
    return !!(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN
    );
  },
};
