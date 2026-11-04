/**
 * Admin = the Supabase Auth user's `app_metadata.role === 'admin'`. `app_metadata` can only be written with the
 * service key (never by the user), unlike `user_metadata`, which users can edit themselves and which therefore
 * must never be trusted for this. Pure, so it is unit-tested. The database re-checks the same claim inside every
 * admin_* function; this is the first of two locks.
 */
export function isAdminUser(user: { app_metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  return user?.app_metadata?.role === "admin";
}
