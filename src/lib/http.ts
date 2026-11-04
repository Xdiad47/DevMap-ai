import { NextResponse, type NextRequest } from "next/server";

/**
 * Cookie-authenticated POST routes must make sure the request really came from OUR pages. SameSite=Lax cookies
 * already block most cross-site POSTs; this is the second lock. Browsers always send `Origin` on a POST.
 */
export function assertSameOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }
  return null;
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
