import { PROTECTED_PREFIXES } from "@/lib/routing";

/**
 * `?next=` comes from the URL, so an attacker can put anything in it:
 *   /login?next=https://evil.example   or   //evil.example   or   /\evil.example
 * After login we would happily redirect there ("open redirect"). We only accept a path that
 * (a) resolves to our own origin and (b) lives under one of our app areas.
 */
export function sanitizeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || next.length > 300) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  try {
    const url = new URL(next, "http://devmap.invalid");
    if (url.origin !== "http://devmap.invalid") return fallback;
    const allowed = PROTECTED_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"));
    return allowed ? url.pathname + url.search : fallback;
  } catch {
    return fallback;
  }
}
