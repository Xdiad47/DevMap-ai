import { timingSafeEqual } from "node:crypto";

/**
 * The cron/worker endpoints do real work with the service role, so they are locked with a shared secret.
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when the env var exists; for any other
 * scheduler (a VPS cron, `npm run workers`) send the same header.
 */
export function verifyCronAuth(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false; // an unset/short secret must never mean "open"
  if (!header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice("Bearer ".length));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
