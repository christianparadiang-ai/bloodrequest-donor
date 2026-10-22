import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicKey } from "@/lib/env";

/**
 * Creates a browser-side Supabase client.
 * Safe to use in Client Components. Uses NEXT_PUBLIC_SUPABASE_ANON_KEY
 * or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = getSupabasePublicKey();

  if (!url || !anonKey) {
    return null;
  }

  return createBrowserClient(url, anonKey);
}
