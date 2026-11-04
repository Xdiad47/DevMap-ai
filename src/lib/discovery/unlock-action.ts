import type { Quote } from "./cards";

export type UnlockStatus = "none" | "unlocked" | "refunded";
export type UnlockAction = { label: string; disabled: boolean; variant: "primary" | "secondary" };

/**
 * What the card's main button says, and whether it may be pressed. The database makes the final decision when
 * `unlock_talent_contact()` runs; this only has to tell the truth about what is about to happen.
 */
export function unlockAction(card: { quote: Quote | null; is_at_daily_cap: boolean }, status: UnlockStatus, trialLeft: number): UnlockAction {
  if (status === "unlocked") return { label: "View contact", disabled: false, variant: "secondary" };
  if (status === "refunded") return { label: "Refunded", disabled: true, variant: "secondary" };
  if (card.is_at_daily_cap) return { label: "Daily limit reached", disabled: true, variant: "secondary" };
  if (!card.quote) return { label: "Unavailable", disabled: true, variant: "secondary" };
  if (card.quote.tier === "standard" && trialLeft > 0) return { label: "Unlock free (preview)", disabled: false, variant: "primary" };
  const n = card.quote.credits;
  return { label: `Unlock · ${n} credit${n === 1 ? "" : "s"}`, disabled: false, variant: "primary" };
}

/** What unlocking would cost THIS recruiter right now: free preview (standard tier only) or N credits. */
export function costFor(quote: Quote, trialLeft: number): { free: boolean; credits: number } {
  if (quote.tier === "standard" && trialLeft > 0) return { free: true, credits: 0 };
  return { free: false, credits: quote.credits };
}
