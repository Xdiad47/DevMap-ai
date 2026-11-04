"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { enforceTalent } from "@/lib/auth/viewer";
import { AttestationError, requestAttestation, type AttestationResult } from "@/lib/attestation/service";
import { createMailer } from "@/lib/attestation/mailer";
import { resolveMailConfig } from "@/lib/attestation/mail-config";
import { resolveSiteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AskState = { error?: string; ok?: AttestationResult } | undefined;

const Form = z.object({
  projectId: z.string().uuid(),
  channel: z.enum(["email", "whatsapp"]),
  contact: z.string().trim().min(3, "Enter your client's e-mail or number.").max(254),
});

/**
 * A talent asks their client to confirm a project. The project is read THROUGH THE TALENT'S SESSION, so Row Level
 * Security (not our code) proves it is theirs; only then does the service role create the request (that function
 * is service-only, so a user can't create requests, or skip the limits, by calling it directly).
 */
export async function askClient(_prev: AskState, fd: FormData): Promise<AskState> {
  const { user, talent } = await enforceTalent("/dashboard/talent");
  const parsed = Form.safeParse(Object.fromEntries(fd.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { projectId, channel, contact } = parsed.data;

  const secret = process.env.ATTESTATION_HMAC_SECRET;
  if (!secret || secret.length < 32) {
    console.error("[attestation] ATTESTATION_HMAC_SECRET is missing or shorter than 32 characters");
    return { error: "This feature isn't configured yet. Please try again later." };
  }

  const sb = await createClient();
  const [projectRes, privRes] = await Promise.all([
    sb.from("projects").select("id, generic_title, live_url, is_ownership_verified").eq("id", projectId).maybeSingle(),
    sb.from("talent_private").select("email, phone_e164, whatsapp_number").maybeSingle(),
  ]);
  if (projectRes.error || privRes.error) return { error: "Something went wrong. Please try again." };
  if (!projectRes.data) return { error: "That project wasn't found on your profile." };
  const priv = privRes.data as { email: string | null; phone_e164: string | null; whatsapp_number: string | null } | null;

  const admin = createAdminClient();
  try {
    const result = await requestAttestation(
      {
        hmacSecret: secret,
        siteUrl: resolveSiteUrl(process.env as Record<string, string | undefined>),
        async createRow(a) {
          const { data, error } = await admin.rpc("create_client_attestation", {
            p_project: a.projectId, p_channel: a.channel, p_contact_masked: a.contactMasked, p_contact_hmac: a.contactHmac, p_token_hash: a.tokenHash,
          });
          if (error) throw new Error(error.message);
          return data as string;
        },
        async expireRow(id) {
          await admin.from("client_attestations").update({ status: "expired" }).eq("id", id);
        },
        sendMail: (m) => createMailer(resolveMailConfig(process.env as Record<string, string | undefined>)).send(m),
      },
      {
        project: projectRes.data as { id: string; generic_title: string; live_url: string; is_ownership_verified: boolean },
        talent: { maskedName: talent.masked_name, emails: [priv?.email ?? null, user.email ?? null], phones: [priv?.phone_e164 ?? null, priv?.whatsapp_number ?? null, user.phone ? `+${user.phone}` : null] },
        channel,
        contact,
      },
    );
    revalidatePath("/dashboard/talent");
    return { ok: result };
  } catch (e) {
    if (e instanceof AttestationError) return { error: e.message };
    console.error("[attestation] unexpected:", e instanceof Error ? e.message : e);
    return { error: "Something went wrong. Please try again." };
  }
}
