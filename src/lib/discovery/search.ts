import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/constants";
import { findCity } from "@/lib/geo/india";
import { CARD_COLUMNS } from "@/lib/queries";
import type { Filters } from "./filters";
import { getIntent, type IntentClause } from "./intents";

export type TalentRow = {
  id: string;
  role: Role;
  masked_name: string;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  native_language: string;
  secondary_languages: string[];
  skills: string[];
  hourly_rate_paise: number;
  is_online: boolean;
  is_at_daily_cap: boolean;
  is_pro: boolean;
  review_status: "unverified" | "reviewed" | "verified";
  proof_score: number;
  response_velocity_score: number;
  composite_rank_score: number;
  verified_live_apps: number;
  uptime_30d_avg: number;
  state_rank: number | null;
  state_cohort_size: number | null;
  last_active_at: string;
};

/** "Nearby" means within this many km of the city the recruiter chose (a latitude/longitude box, so it stays one cheap query). */
export const NEARBY_KM = 250;

/** Options that are NOT part of the user's URL filters; only the relaxation steps use them. */
export type QueryOptions = { activeWithinDays?: number; near?: { lat: number; lng: number; km: number } };

export const PAGE_SIZE = 60; // pilot scale (<= a few hundred profiles). Cursor pagination arrives when it's needed.

/** What the search actually used, and why, so the UI can say it plainly instead of silently changing the query. */
export type SearchOutcome = {
  rows: TalentRow[];
  total: number;
  applied: Filters & QueryOptions;
  notice: string | null;
  roleCounts: Record<Role, number>;
};

// ---------------------------------------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------------------------------------

/** The intent's (role, skills) clauses, restricted to the chosen role if there is one. */
export function effectiveClauses(f: Filters): IntentClause[] {
  const intent = getIntent(f.intent);
  if (intent) return intent.clauses;
  if (f.role) return [{ role: f.role, skills: [] }];
  return [];
}

/** PostgREST `or=(...)` expression for the clauses. Inputs come from our own constants, never from the user. */
export function clausesExpression(clauses: IntentClause[]): string | null {
  if (clauses.length === 0) return null;
  const parts = clauses.map((c) =>
    c.skills.length > 0 ? `and(role.eq.${c.role},skills.ov.{${c.skills.join(",")}})` : `role.eq.${c.role}`,
  );
  return parts.length === 1 && !parts[0].startsWith("and(") ? parts[0] : parts.join(",");
}

/** Effective language: the user's choice, else the one the intent implies (none of the built-in intents imply one today). */
export function effectiveLanguage(f: Filters): string | undefined {
  return f.language ?? getIntent(f.intent)?.language;
}

// The query builder type is deliberately loose: supabase-js's generic builder types are unwieldy here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;

export function applyFilters(q: Q, f: Filters, o: QueryOptions = {}): Q {
  if (f.state) q = q.eq("state", f.state);
  if (f.city) q = q.eq("city", f.city);
  if (o.near) {
    const dLat = o.near.km / 111;
    const dLng = o.near.km / (111 * Math.max(0.2, Math.cos((o.near.lat * Math.PI) / 180)));
    q = q.gte("latitude", o.near.lat - dLat).lte("latitude", o.near.lat + dLat).gte("longitude", o.near.lng - dLng).lte("longitude", o.near.lng + dLng);
  }
  if (f.online) q = q.eq("is_online", true);
  if (f.maxRate) q = q.lte("hourly_rate_paise", f.maxRate * 100);
  const language = effectiveLanguage(f);
  if (language) q = q.or(`native_language.eq.${language},secondary_languages.cs.{${language}}`);
  const expr = clausesExpression(effectiveClauses(f));
  if (expr) q = q.or(expr);
  if (o.activeWithinDays) q = q.gte("last_active_at", new Date(Date.now() - o.activeWithinDays * 86_400_000).toISOString());
  return q;
}

async function run(sb: SupabaseClient, f: Filters, o: QueryOptions) {
  const q = applyFilters(sb.from("talent_public").select(CARD_COLUMNS, { count: "exact" }), f, o)
    .order("composite_rank_score", { ascending: false })
    .order("verified_live_apps", { ascending: false })
    .order("uptime_30d_avg", { ascending: false })
    .order("last_proof_activity_at", { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE);
  const { data, count, error } = await q;
  if (error) throw new Error(`search failed: ${error.message}`);
  return { rows: (data ?? []) as TalentRow[], total: count ?? 0 };
}

// ---------------------------------------------------------------------------------------------------------
// Relaxation (PRD §9.2): never leave the recruiter at a dead end, never lie about what is being shown.
// ---------------------------------------------------------------------------------------------------------

export type AttemptKind = "exact" | "nearby" | "online" | "anywhere";
export type Attempt = { kind: AttemptKind; options: QueryOptions; filters: Filters; notice: string | null };

/**
 * The ordered searches we MAY try (PRD §9.2). Each relaxation is cumulative:
 *   nearby    drop the city/state, keep builders within ~250 km   "Nobody in Surat yet. Showing builders within about 250 km."
 *   online    also drop "Online now", active this week           "Nobody matching is Online right now..."
 *   anywhere  also drop the place entirely                       "Nobody near Surat yet. Showing the best matches across India..."
 * Why "across India" is honest and useful: the work is remote, so a developer in another city can still build the site.
 * The LANGUAGE and the role/intent are never relaxed: they are the product's promise.
 * Whether each step actually RUNS is decided by `orchestrate()` from the result counts.
 */
export function planAttempts(f: Filters): Attempt[] {
  const attempts: Attempt[] = [{ kind: "exact", options: {}, filters: f, notice: null }];
  let cur: Filters = f;
  let opts: QueryOptions = {};

  const centre = findCity(f.city);
  if (centre) {
    cur = { ...cur, city: undefined, state: undefined };
    opts = { ...opts, near: { lat: centre.lat, lng: centre.lng, km: NEARBY_KM } };
    attempts.push({ kind: "nearby", options: { ...opts }, filters: cur, notice: `Nobody in ${centre.name} yet. Showing builders within about ${NEARBY_KM} km.` });
  }
  if (f.online) {
    cur = { ...cur, online: false };
    opts = { ...opts, activeWithinDays: 7 };
    attempts.push({ kind: "online", options: { ...opts }, filters: cur, notice: "Nobody matching is Online right now. Showing builders who were active this week." });
  }
  if (f.city || f.state) {
    cur = { ...cur, city: undefined, state: undefined };
    opts = { ...opts, near: undefined };
    const where = f.city ? `near ${f.city}` : `in ${f.state}`;
    attempts.push({ kind: "anywhere", options: { ...opts }, filters: cur, notice: `Nobody ${where} yet. Showing the best matches across India. Most of our builders work remotely.` });
  }
  return attempts;
}

export type RunResult = { rows: TalentRow[]; total: number };
export type Chosen = { attempt: Attempt; result: RunResult };

/**
 * Decides which attempt to show, running as few queries as it can:
 *  - the exact search wins with 2+ matches;
 *  - with 0 or 1 match, widening the CITY to "nearby" is allowed (a recruiter in one city should see the region);
 *  - every later step is allowed ONLY while nothing at all has been found. We never swap one real result for a
 *    wider set just because it is wider, and we never print a notice that isn't true.
 */
export async function orchestrate(plan: Attempt[], runner: (a: Attempt) => Promise<RunResult>): Promise<Chosen> {
  const exact = plan[0];
  let best: Chosen = { attempt: exact, result: await runner(exact) };
  if (best.result.total >= 2) return best;

  for (const a of plan.slice(1)) {
    if (a.kind !== "nearby" && best.result.total >= 1) break;
    const result = await runner(a);
    if (a.kind === "nearby") {
      if (result.total > best.result.total) return { attempt: a, result }; // genuinely more people to show
      continue; // the region found nothing new: keep the exact result, say nothing
    }
    if (result.total >= 1) return { attempt: a, result };
    best = { attempt: a, result }; // remember the widest empty attempt, for the "nothing found" state
  }
  return best;
}

/** Role counts for the chips, ignoring the role/intent filter itself so the numbers help you choose. */
async function countRoles(sb: SupabaseClient, f: Filters, o: QueryOptions): Promise<Record<Role, number>> {
  const base: Filters = { ...f, role: undefined, intent: undefined };
  const q = applyFilters(sb.from("talent_public").select("role"), base, o).limit(1000);
  const { data, error } = await q;
  if (error) throw new Error(`role counts failed: ${error.message}`);
  const counts: Record<Role, number> = { developer: 0, designer: 0, marketer: 0 };
  for (const r of (data ?? []) as { role: Role }[]) counts[r.role] += 1;
  return counts;
}

/** Straight-line distance in km (haversine). Used only to put the closest people first in the "nearby" fallback. */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export async function searchTalent(sb: SupabaseClient, f: Filters): Promise<SearchOutcome> {
  const { attempt, result } = await orchestrate(planAttempts(f), (a) => run(sb, a.filters, a.options));
  const near = attempt.options.near;
  // Nearby results: closest first (the sort is stable, so equally distant people keep their rank order).
  const rows = near
    ? [...result.rows].sort((x, y) => distanceKm(near.lat, near.lng, x.latitude ?? 0, x.longitude ?? 0) - distanceKm(near.lat, near.lng, y.latitude ?? 0, y.longitude ?? 0))
    : result.rows;
  return {
    rows,
    total: result.total,
    applied: { ...attempt.filters, ...attempt.options },
    notice: result.total > 0 ? attempt.notice : null,
    roleCounts: await countRoles(sb, attempt.filters, attempt.options),
  };
}
