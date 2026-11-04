/**
 * Where should this signed-in user be, given which profiles they already have?
 *
 * Pure function on purpose: no cookies, no database. Server pages call it through
 * `enforce()` (src/lib/auth/viewer.ts); unit tests call it directly.
 *
 * Returns the path to redirect to, or `null` when the user may stay.
 */
export type ProfileState = { talent: boolean; recruiter: boolean };

/** The "home" for a signed-in user. */
export function homeFor(state: ProfileState): string {
  if (state.talent) return "/dashboard/talent";
  if (state.recruiter) return "/explore";
  return "/onboard";
}

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(base + "/");

export function guard(pathname: string, state: ProfileState): string | null {
  // /dashboard on its own is just a signpost.
  if (pathname === "/dashboard") return homeFor(state);

  // Talent area needs a talent profile; otherwise send them to the talent onboarding step.
  if (under(pathname, "/dashboard/talent")) return state.talent ? null : "/onboard/talent";

  // Recruiter area (placeholder in Sprint 1) needs a recruiter profile.
  if (under(pathname, "/explore")) {
    if (state.recruiter) return null;
    return state.talent ? "/dashboard/talent" : "/onboard/recruiter";
  }

  // Onboarding pages are for people who have NOT finished that profile yet.
  if (pathname === "/onboard/talent") return state.talent ? "/dashboard/talent" : null;
  if (pathname === "/onboard/recruiter") return state.recruiter ? "/explore" : null;

  // The role chooser: skip it if they already have a profile.
  if (pathname === "/onboard") return state.talent || state.recruiter ? homeFor(state) : null;

  // anything else: no profile requirement.
  return null;
}

/** Paths that need a signed-in user at all. Used by the proxy (cheap, cookie-only check). */
export const PROTECTED_PREFIXES = ["/dashboard", "/onboard", "/explore", "/admin"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => under(pathname, p));
}
