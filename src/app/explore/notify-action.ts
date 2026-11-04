"use server";

import { enforceRecruiter } from "@/lib/auth/viewer";
import { createMailer } from "@/lib/attestation/mailer";
import { resolveMailConfig } from "@/lib/attestation/mail-config";
import { getCompany } from "@/lib/company";
import { unlockEmail } from "@/lib/notify/unlock-email";
import { resolveSiteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Tell the talent, by e-mail, that a recruiter unlocked them. Called by the unlock screen AFTER the unlock succeeded.
 *
 * Safety:
 *  - The unlock is looked up through the RECRUITER'S OWN session, so Row Level Security proves this recruiter really unlocked this talent.
 *  - `talent_notified_at` is claimed atomically first, so a double click or a retry sends one e-mail, never two.
 *  - It never throws: the recruiter already has the contact, and a mail problem must not break that. A failed send releases the claim.
 */
export async function notifyTalentOfUnlock(talentId: string): Promise<void> {
  try {
    const { recruiter } = await enforceRecruiter("/explore");
    const sb = await createClient();
    const mine = await sb.from("lead_unlocks").select("id, talent_notified_at").eq("talent_id", talentId).maybeSingle();
    if (mine.error || !mine.data || mine.data.talent_notified_at) return;

    const admin = createAdminClient();
    const claim = await admin
      .from("lead_unlocks")
      .update({ talent_notified_at: new Date().toISOString() })
      .eq("id", mine.data.id)
      .is("talent_notified_at", null)
      .select("id");
    if (claim.error || !claim.data || claim.data.length === 0) return; // someone else already sent it

    try {
      const [priv, pub] = await Promise.all([
        admin.from("talent_private").select("email").eq("talent_id", talentId).maybeSingle(),
        admin.from("talent_public").select("masked_name").eq("id", talentId).maybeSingle(),
      ]);
      const to = (priv.data as { email: string | null } | null)?.email;
      if (!to) throw new Error("talent has no e-mail on file");
      const env = process.env as Record<string, string | undefined>;
      const mail = unlockEmail({
        talentName: (pub.data as { masked_name: string } | null)?.masked_name ?? "there",
        recruiterCompany: recruiter.company_name,
        dashboardUrl: `${resolveSiteUrl(env)}/dashboard/talent`,
        supportEmail: getCompany(env).supportEmail,
      });
      await createMailer(resolveMailConfig(env)).send({ to, ...mail });
    } catch (e) {
      console.error("[notify] unlock e-mail failed:", e instanceof Error ? e.message : e);
      await admin.from("lead_unlocks").update({ talent_notified_at: null }).eq("id", mine.data.id);
    }
  } catch (e) {
    console.error("[notify] unlock notification skipped:", e instanceof Error ? e.message : e);
  }
}
