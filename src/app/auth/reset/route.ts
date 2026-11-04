import { NextResponse, type NextRequest } from "next/server";
import { sanitizeNext } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Where protected pages send a visitor whose session cookie is no good.
 *
 * The proxy only checks that the cookie's token is correctly SIGNED (cheap, no database); a page then asks the auth server whether
 * that user still EXISTS. If the account was erased, or the database was reset, the token is still validly signed but names nobody.
 * Sending that visitor straight to /login made the proxy bounce them back ("you're signed in") and the page bounce them out again:
 * an endless redirect loop. Here we throw the dead session away first, then show the login page.
 *
 * It only clears a session the auth server has just confirmed is dead, so someone else's page can't use it to sign you out.
 */
export async function GET(request: NextRequest) {
  const next = sanitizeNext(request.nextUrl.searchParams.get("next"));
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) return NextResponse.redirect(new URL(next, request.nextUrl.origin)); // the session is fine: nothing to reset

  await supabase.auth.signOut({ scope: "local" }); // local: just forget the cookies, don't ask the server
  const login = new URL("/login", request.nextUrl.origin);
  login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}
