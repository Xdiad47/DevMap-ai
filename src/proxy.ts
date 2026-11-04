import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPath } from "@/lib/routing";
import { redirectWithCookies, updateSession } from "@/lib/supabase/session";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`. It runs before every matched request.
 *
 * What it does:  refresh the session + send signed-out visitors away from private areas.
 * What it does NOT do: look up profiles in the database. Proxy also runs on link prefetches,
 * so Next.js advises cheap cookie-only checks here. "Incomplete profile -> onboarding step"
 * redirects live in the pages instead (see `enforce()` in src/lib/auth/viewer.ts).
 */
export async function proxy(request: NextRequest) {
  const { response, claims } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (isProtectedPath(pathname) && !claims) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + search);
    return redirectWithCookies(login, response);
  }

  // Already signed in? The login page has nothing to offer.
  if (pathname === "/login" && claims) {
    return redirectWithCookies(new URL("/dashboard", request.url), response);
  }

  return response ?? NextResponse.next();
}

export const config = {
  // Everything except static assets, so sessions stay fresh on every page view.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
