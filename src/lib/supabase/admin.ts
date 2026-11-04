import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";

/**
 * Service-role client. It BYPASSES Row Level Security, so it is deliberately tiny and used only by server
 * routes that act as the PLATFORM, never as a user:
 *   - payment routes  (`create_payment_order()` / `fulfill_payment()` are service-role only: that is what stops a
 *     recruiter from granting themselves credits)
 *   - the cron workers (GitHub scorer, pinger) and the unlock e-mail:
 *     every one of them is gated by a shared secret (CRON_SECRET) or the recruiter's own session before this runs.
 *
 * Rules: never import this from a Client Component (`server-only` makes the build fail if you do), never
 * put the key in a NEXT_PUBLIC_ variable, never pass user-supplied SQL/filters through it.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (server-side only; needed for payments, e-mails and the workers).");
  return createClient(getSupabaseEnv().url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
