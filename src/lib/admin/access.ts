import "server-only";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "./guard";

/**
 * Call at the top of EVERY admin page, server action and route: layouts are not re-run on client-side navigation,
 * so a check there alone is not a lock.
 *
 *  - signed out         -> /login
 *  - signed in, not admin -> 404 (we do not confirm the area exists)
 *  - admin              -> { user, sb, db }
 *      sb = the admin's OWN session client: used for the admin_* actions, so `reviewer_id` / the audit log name a person
 *      db = service-role client: used only to READ the queues (the tables are otherwise invisible to everyone)
 *
 * `getUser()` asks the Auth server (fresh app_metadata), not just the cookie.
 */
export async function requireAdmin(next = "/admin/review-queue") {
  const user = await getUser();
  if (!user) redirect(`/auth/reset?next=${encodeURIComponent(next)}`);
  if (!isAdminUser(user)) notFound();
  return { user, sb: await createClient(), db: createAdminClient() };
}
