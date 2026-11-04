/**
 * The public address used in links we E-MAIL (client attestation). It must come from configuration, never from the
 * request's Host header: an attacker who can set Host would otherwise get our emails to carry a link to their site.
 */
export function resolveSiteUrl(env: Record<string, string | undefined>): string {
  const v = env.NEXT_PUBLIC_SITE_URL;
  if (v) {
    if (!/^https?:\/\/[^/\s]+$/.test(v.replace(/\/$/, ""))) throw new Error("NEXT_PUBLIC_SITE_URL must look like https://devmap.in (no path).");
    if (env.NODE_ENV === "production" && !v.startsWith("https://")) throw new Error("NEXT_PUBLIC_SITE_URL must be https in production.");
    return v.replace(/\/$/, "");
  }
  if (env.NODE_ENV === "production") throw new Error("Set NEXT_PUBLIC_SITE_URL (e.g. https://devmap.in).");
  return "http://localhost:3000";
}
