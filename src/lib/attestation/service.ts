import type { Channel } from "./contact";
import { contactHmac, isOwnContact, maskContact, normalizeContact } from "./contact";
import { attestationEmail, whatsappText } from "./email";
import { hashToken, newToken } from "./token";

/**
 * "Ask a client to confirm this project" (PRD §8.3). Everything that can go wrong is a typed error with a message a
 * talent can act on. All I/O is injected, so the whole flow (including "mail failed") is unit-tested.
 */
export const ATTESTATION_DAYS = 7; // matches client_attestations.expires_at default

export class AttestationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface AttestationDeps {
  hmacSecret: string;
  siteUrl: string;
  createRow(a: { projectId: string; channel: Channel; contactMasked: string; contactHmac: string; tokenHash: string }): Promise<string>;
  expireRow(id: string): Promise<void>;
  sendMail(m: { to: string; subject: string; text: string; html: string }): Promise<void>;
}
export type AttestationInput = {
  project: { id: string; generic_title: string; live_url: string; is_ownership_verified: boolean };
  talent: { maskedName: string; emails: (string | null)[]; phones: (string | null)[] };
  channel: Channel;
  contact: string;
};
export type AttestationResult = { channel: Channel; sentTo: string; waLink?: string };

const DB_ERRORS: [string, string][] = [
  ["attestor_limit_reached", "This client has already confirmed two projects in the last 30 days, which is the limit. Ask a different client, or verify the site yourself with devmap-verify.txt."],
  ["too_many_pending", "This project already has 3 requests waiting. Wait for a reply or for them to expire (7 days)."],
  ["contact_rate_limited", "We've already contacted this client 3 times today. Please wait until tomorrow."],
  ["talent_rate_limited", "You've sent 5 confirmation requests today, which is the limit. Try again tomorrow."],
  ["project_not_found", "That project no longer exists."],
];

export async function requestAttestation(deps: AttestationDeps, input: AttestationInput): Promise<AttestationResult> {
  if (input.project.is_ownership_verified) throw new AttestationError("already_verified", "This project is already verified.");

  const canonical = normalizeContact(input.channel, input.contact);
  if (!canonical) {
    throw new AttestationError("invalid_contact", input.channel === "email" ? "Enter a valid e-mail address for your client." : "Enter a valid 10-digit Indian mobile number for your client.");
  }
  if (isOwnContact(input.channel, canonical, { emails: input.talent.emails, phones: input.talent.phones })) {
    throw new AttestationError("own_contact", "That's your own e-mail or number. A confirmation has to come from your client.");
  }

  const token = newToken();
  const masked = maskContact(input.channel, canonical);
  let id: string;
  try {
    id = await deps.createRow({
      projectId: input.project.id,
      channel: input.channel,
      contactMasked: masked,
      contactHmac: contactHmac(deps.hmacSecret, input.channel, canonical),
      tokenHash: hashToken(token),
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const hit = DB_ERRORS.find(([m]) => raw.includes(m));
    if (hit) throw new AttestationError(hit[0], hit[1]);
    throw e;
  }

  const link = `${deps.siteUrl.replace(/\/$/, "")}/verify/attestation?token=${token}`;
  if (input.channel === "whatsapp") {
    // Nothing is sent by us: the talent opens WhatsApp with the message ready. The number is used for this one URL only.
    const text = whatsappText({ talentName: input.talent.maskedName, title: input.project.generic_title, link });
    return { channel: "whatsapp", sentTo: masked, waLink: `https://wa.me/${canonical.replace(/\D/g, "")}?text=${encodeURIComponent(text)}` };
  }

  const mail = attestationEmail({ talentName: input.talent.maskedName, title: input.project.generic_title, site: input.project.live_url, link, days: ATTESTATION_DAYS });
  try {
    await deps.sendMail({ to: canonical, ...mail });
  } catch (e) {
    // The e-mail never left: release the slot so it doesn't count as a pending request.
    await deps.expireRow(id).catch(() => {});
    console.error("[attestation] mail failed:", e instanceof Error ? e.message : "unknown");
    throw new AttestationError("mail_failed", "We couldn't send the e-mail just now. Nothing was used up: please try again in a few minutes.");
  }
  return { channel: "email", sentTo: masked };
}

export type ClientAnswer = "confirmed" | "declined" | "invalid" | "limit_reached";
export const isClientAnswer = (v: unknown): v is ClientAnswer => v === "confirmed" || v === "declined" || v === "invalid" || v === "limit_reached";
