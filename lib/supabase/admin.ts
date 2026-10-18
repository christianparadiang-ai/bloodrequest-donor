import { createClient } from "@supabase/supabase-js";

/**
 * PRIVILEGED SERVICE ROLE SUPABASE CLIENT.
 * NEVER IMPORT THIS IN CLIENT-SIDE CODE.
 * Restricted strictly to:
 * 1. Clerk webhook user profile synchronization.
 * 2. Immutable audit logging triggers.
 * 3. System-level background operations.
 */
export function createSupabaseAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "SECURITY CRITICAL: Attempted to instantiate Supabase Admin Client in client browser!"
    );
  }

  if (typeof globalThis.WebSocket === "undefined") {
    // Provide WebSocket stub for Node 20 environment to prevent realtime-js constructor error
    globalThis.WebSocket = class {} as unknown as typeof WebSocket;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return null;
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
