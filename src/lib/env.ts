/**
 * Public env vars. Next.js only inlines `process.env.NEXT_PUBLIC_*` into browser code when it
 * can see the literal name, so each one is read explicitly here (no `process.env[name]`).
 *
 * The service_role key is deliberately NOT read anywhere in this app. Sprint 1 never needs
 * it, and keeping it out of the Next.js codebase removes a whole class of leak.
 */
export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in.",
    );
  }
  return { url, anonKey };
}

