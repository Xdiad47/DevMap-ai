import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";

/**
 * Called by src/proxy.ts on every request. Two jobs:
 *  1. Refresh the auth cookies if the access token is about to expire (otherwise users get
 *     randomly signed out).
 *  2. Tell the proxy whether there is a valid session, using `getClaims()` — it verifies the
 *     JWT signature locally (no round-trip to Supabase when asymmetric signing keys are on).
 *     That is the "cheap, optimistic" check Next.js recommends for proxy.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        // Write refreshed cookies to BOTH the request (so server code in this same request sees
        // them) and the response (so the browser stores them).
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  return { response, claims: data?.claims ?? null };
}

/** A redirect must carry the refreshed cookies too, or the refresh is lost and the user bounces. */
export function redirectWithCookies(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
