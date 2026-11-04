import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/env";

/**
 * Supabase client for Client Components (runs in the browser).
 * Uses the signed-in user's JWT, so every query is still subject to Row Level Security.
 *
 * Used where the BROWSER must be the caller, e.g. `record_consent` (the database logs the
 * caller's IP address as DPDP evidence; a server-side call would log our server's IP).
 */
export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
