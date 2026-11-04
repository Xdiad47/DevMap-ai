/**
 * Grants (or revokes) the admin role. `app_metadata` can only be written with the service key, so users cannot give it to
 * themselves (unlike `user_metadata`). The person must sign OUT and IN again afterwards so their session carries the role.
 *
 *   npx supabase status -o env      # prints API_URL and SERVICE_ROLE_KEY
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/make-admin.mjs you@example.com
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/make-admin.mjs you@example.com --revoke
 *
 * In production run this from your own machine against the hosted project; never expose the service key to the app's users.
 */
import { createClient } from "@supabase/supabase-js";

const [email, flag] = process.argv.slice(2);
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !url || !key) throw new Error("Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/make-admin.mjs <email> [--revoke]");

const admin = createClient(url, key, { auth: { persistSession: false } });
let user = null;
for (let page = 1; page <= 20 && !user; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
  if (data.users.length < 200) break;
}
if (!user) throw new Error(`No user with e-mail ${email}. They must sign in once first.`);

const app_metadata = { ...user.app_metadata, role: flag === "--revoke" ? undefined : "admin" };
if (flag === "--revoke") delete app_metadata.role;
const { error } = await admin.auth.admin.updateUserById(user.id, { app_metadata });
if (error) throw error;
console.log(flag === "--revoke" ? `Removed admin from ${email}.` : `${email} is now an admin. They must sign out and back in.`);
