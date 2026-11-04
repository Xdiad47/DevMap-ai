import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeNext } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Where OAuth (GitHub / Google) and email magic links land.
 *   ?code=...                      OAuth / PKCE flow  -> exchange for a session
 *   ?token_hash=...&type=email     magic link          -> verify the one-time token
 * Either way the session cookie is set here, then we send the user on to `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = sanitizeNext(searchParams.get("next"));
  const supabase = await createClient();

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  let error: { message: string } | null = null;
  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type }));
  } else {
    error = { message: searchParams.get("error_description") ?? "Missing sign-in code" };
  }

  if (error) {
    const login = new URL("/login", origin);
    login.searchParams.set("error", "That sign-in link is invalid or has expired. Please try again.");
    login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }
  return NextResponse.redirect(new URL(next, origin));
}
