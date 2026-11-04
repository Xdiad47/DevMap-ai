import { createHmac } from "node:crypto";
import { z } from "zod";
import { normalizeIndianMobile } from "@/lib/phone";

/**
 * The client's e-mail or mobile number is personal data we don't need to keep: we store only a MASKED label ("r***@acme.in")
 * and a keyed hash (HMAC) so the database can apply the abuse limits ("2 confirmations per client per 30 days", "asked at
 * most 3 times a day") without ever holding the address. Pure functions, unit-tested.
 */
export type Channel = "email" | "whatsapp";

const emailSchema = z.string().email().max(254);

export function normalizeEmail(input: string): string | null {
  const v = input.trim().toLowerCase();
  return emailSchema.safeParse(v).success ? v : null;
}

/** Returns the canonical contact ("a@b.in" or "+919876543210") or null when it isn't valid for that channel. */
export function normalizeContact(channel: Channel, input: string): string | null {
  return channel === "email" ? normalizeEmail(input) : normalizeIndianMobile(input);
}

export function maskContact(channel: Channel, canonical: string): string {
  if (channel === "email") {
    const [local, domain] = canonical.split("@");
    return `${local[0]}***@${domain}`;
  }
  return `+91 ••••• ••${canonical.slice(-3)}`;
}

export function contactHmac(secret: string, channel: Channel, canonical: string): string {
  return createHmac("sha256", secret).update(`${channel}:${canonical}`).digest("hex");
}

/** A talent must not confirm their own work: the contact may not be any e-mail or number we hold for them. */
export function isOwnContact(channel: Channel, canonical: string, own: { emails: (string | null | undefined)[]; phones: (string | null | undefined)[] }): boolean {
  if (channel === "email") {
    const mine = own.emails.map((e) => (e ? normalizeEmail(e) : null));
    // gmail ignores dots and +tags, so those aliases are the same inbox
    const key = (e: string) => {
      const [l, d] = e.split("@");
      return d === "gmail.com" || d === "googlemail.com" ? `${l.split("+")[0].replaceAll(".", "")}@gmail.com` : `${l.split("+")[0]}@${d}`;
    };
    return mine.some((m) => m !== null && key(m) === key(canonical));
  }
  return own.phones.map((p) => (p ? normalizeIndianMobile(p) : null)).some((p) => p === canonical);
}
