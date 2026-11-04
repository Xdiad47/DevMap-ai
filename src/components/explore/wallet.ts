import type { SupabaseClient } from "@supabase/supabase-js";

export type Wallet = { balance: number; trial: number };
export type Bundle = { id: string; label: string; credits: number; price_paise: number };

export async function fetchWallet(sb: SupabaseClient): Promise<Wallet> {
  const { data, error } = await sb.from("recruiters").select("credits_balance, trial_unlocks_remaining").maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "no recruiter row");
  return { balance: data.credits_balance, trial: data.trial_unlocks_remaining };
}

/**
 * After paying, the credits arrive when the server fulfils the order (browser callback and/or webhook). The page can
 * be ahead of that by a moment, so poll the balance for up to `timeoutMs` (PRD §10.3: "UI updates in < 3 s").
 */
export async function waitForBalanceAbove(sb: SupabaseClient, before: number, timeoutMs = 30_000): Promise<Wallet | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const w = await fetchWallet(sb).catch(() => null);
    if (w && w.balance > before) return w;
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}
