import type { SupabaseClient } from "@supabase/supabase-js";
import type { TalentRow } from "./search";

export type Quote = { tier: "standard" | "top_tier"; credits: number };
export type ProjectTitle = { generic_title: string; uptime_30d: number; is_up: boolean | null };
export type TalentCard = TalentRow & { quote: Quote | null; projects: ProjectTitle[] };

/**
 * Adds the two things a card needs that the public table can't give:
 *   - the unlock price, computed by the DATABASE (`unlock_quotes`; the app never re-implements the tier rule)
 *   - abstracted titles of ownership-verified projects (`talent_project_titles`; never URLs)
 * Two round trips for the whole page, however many cards.
 */
export async function attachCardExtras(sb: SupabaseClient, rows: TalentRow[]): Promise<TalentCard[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [quotes, titles] = await Promise.all([
    sb.rpc("unlock_quotes", { p_ids: ids }),
    sb.rpc("talent_project_titles", { p_ids: ids }),
  ]);
  if (quotes.error) throw new Error(`unlock_quotes failed: ${quotes.error.message}`);
  if (titles.error) throw new Error(`talent_project_titles failed: ${titles.error.message}`);

  const quoteMap = (quotes.data ?? {}) as Record<string, Quote>;
  const byTalent = new Map<string, ProjectTitle[]>();
  for (const t of (titles.data ?? []) as (ProjectTitle & { talent_id: string })[]) {
    const list = byTalent.get(t.talent_id) ?? [];
    list.push({ generic_title: t.generic_title, uptime_30d: Number(t.uptime_30d), is_up: t.is_up });
    byTalent.set(t.talent_id, list);
  }
  return rows.map((r) => ({ ...r, quote: quoteMap[r.id] ?? null, projects: byTalent.get(r.id) ?? [] }));
}
