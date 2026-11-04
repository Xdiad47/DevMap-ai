import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Read side of the admin screens. Takes a SERVICE-ROLE client from the caller (see access.ts) because the review
 * queue and the talent vault are invisible to everyone else. Explicit column lists: the admin sees what a reviewer
 * needs (name, links, GitHub, evidence) but never a phone number or e-mail.
 */
export const GROUPS = {
  portfolio: { label: "Portfolios", types: ["designer_portfolio", "marketer_portfolio"], blurb: "Designers and marketers waiting for a work-depth score." },
  ghost: { label: "Ghost disputes", types: ["ghost_dispute"], blurb: "The talent says they replied. Recruiter's report vs the talent's evidence." },
  ban: { label: "Strike 3 / bans", types: ["ban_review"], blurb: "A third strike needs a person's decision before any permanent ban." },
  attestation: { label: "Attestation spot-checks", types: ["attestation_spotcheck"], blurb: "A client confirmed a project. 10% are checked at random; WhatsApp-sent links always." },
} as const;
export type GroupKey = keyof typeof GROUPS;
export const GROUP_KEYS = Object.keys(GROUPS) as GroupKey[];
export const groupOfType = (type: string): GroupKey => GROUP_KEYS.find((g) => (GROUPS[g].types as readonly string[]).includes(type)) ?? "portfolio";

export type QueueItem = {
  id: string;
  type: string;
  status: "pending" | "in_review" | "approved" | "rejected";
  talent_id: string | null;
  related_id: string | null;
  evidence_urls: string[];
  reviewer_notes: string | null;
  created_at: string;
  resolved_at: string | null;
};
export type TalentBrief = { id: string; masked_name: string; role: string; city: string; state: string };

const ITEM_COLUMNS = "id, type, status, talent_id, related_id, evidence_urls, reviewer_notes, created_at, resolved_at";
const OPEN = ["pending", "in_review"];

function must<T>(what: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`admin ${what} failed: ${r.error.message}`);
  return (r.data ?? ([] as unknown as T)) as T;
}

export async function queueCounts(db: SupabaseClient): Promise<Record<GroupKey, number>> {
  const rows = must("counts", await db.from("review_queue").select("type").in("status", OPEN).limit(5000)) as { type: string }[];
  const out = { portfolio: 0, ghost: 0, ban: 0, attestation: 0 } satisfies Record<GroupKey, number>;
  for (const r of rows) out[groupOfType(r.type)]++;
  return out;
}

export async function listItems(db: SupabaseClient, group: GroupKey, state: "open" | "resolved", limit = 50): Promise<{ items: QueueItem[]; talents: Map<string, TalentBrief> }> {
  let q = db.from("review_queue").select(ITEM_COLUMNS).in("type", [...GROUPS[group].types]);
  q = state === "open" ? q.in("status", OPEN).order("created_at", { ascending: true }) : q.not("status", "in", `(${OPEN.join(",")})`).order("resolved_at", { ascending: false });
  const items = must("list", await q.limit(limit)) as QueueItem[];
  return { items, talents: await talentBriefs(db, items.map((i) => i.talent_id)) };
}

export async function talentBriefs(db: SupabaseClient, ids: (string | null)[]): Promise<Map<string, TalentBrief>> {
  const uniq = [...new Set(ids.filter((i): i is string => !!i))];
  if (uniq.length === 0) return new Map();
  const rows = must("talents", await db.from("talent_public").select("id, masked_name, role, city, state").in("id", uniq)) as TalentBrief[];
  return new Map(rows.map((r) => [r.id, r]));
}

export async function getItem(db: SupabaseClient, id: string): Promise<QueueItem | null> {
  const r = await db.from("review_queue").select(ITEM_COLUMNS).eq("id", id).maybeSingle();
  if (r.error) throw new Error(`admin item failed: ${r.error.message}`);
  return (r.data as QueueItem | null) ?? null;
}

// ----- the person behind an item: what a reviewer is allowed to see -----
export type TalentFile = {
  id: string;
  masked_name: string;
  role: string;
  city: string;
  state: string;
  skills: string[];
  review_status: string;
  proof_score: number;
  is_banned: boolean;
  is_listed: boolean;
  suspended_until: string | null;
  full_name: string | null;
  github_username: string | null;
  portfolio_links: unknown;
  projects: { generic_title: string; live_url: string; is_ownership_verified: boolean; verification_method: string; uptime_30d: number }[];
  strikes: { id: string; status: string; created_at: string; expires_at: string; report_id: string }[];
};

export async function talentFile(db: SupabaseClient, id: string): Promise<TalentFile | null> {
  const [pub, priv, projects, strikes] = await Promise.all([
    db.from("talent_public").select("id, masked_name, role, city, state, skills, review_status, proof_score, is_banned, is_listed, suspended_until").eq("id", id).maybeSingle(),
    db.from("talent_private").select("full_name, github_username, portfolio_links").eq("talent_id", id).maybeSingle(),
    db.from("projects").select("generic_title, live_url, is_ownership_verified, verification_method, uptime_30d").eq("talent_id", id).order("created_at"),
    db.from("strikes").select("id, status, created_at, expires_at, report_id").eq("talent_id", id).order("created_at", { ascending: false }),
  ]);
  for (const r of [pub, priv, projects, strikes]) if (r.error) throw new Error(`admin talent file failed: ${r.error.message}`);
  if (!pub.data) return null;
  return { ...(pub.data as object), ...((priv.data as object | null) ?? { full_name: null, github_username: null, portfolio_links: [] }), projects: projects.data ?? [], strikes: strikes.data ?? [] } as TalentFile;
}

export type GhostCase = {
  id: string;
  status: string;
  recruiter_note: string | null;
  talent_dispute_note: string | null;
  evidence_urls: string[];
  talent_deadline: string;
  created_at: string;
  talent_id: string;
  unlock: { credits_deducted: number; created_at: string; whatsapp_clicked_at: string | null; tier_at_unlock: string; talent_acknowledged_at: string | null } | null;
  recruiter_company: string | null;
  recruiter_reports_this_month: number;
};

export async function ghostCase(db: SupabaseClient, reportId: string): Promise<GhostCase | null> {
  const rep = await db.from("ghost_reports").select("id, status, recruiter_note, talent_dispute_note, evidence_urls, talent_deadline, created_at, talent_id, unlock_id, recruiter_id").eq("id", reportId).maybeSingle();
  if (rep.error) throw new Error(`admin ghost case failed: ${rep.error.message}`);
  const r = rep.data as (Omit<GhostCase, "unlock" | "recruiter_company" | "recruiter_reports_this_month"> & { unlock_id: string; recruiter_id: string }) | null;
  if (!r) return null;
  const monthStart = new Date(Date.now() - 31 * 86_400_000).toISOString();
  const [unlock, rec, count] = await Promise.all([
    db.from("lead_unlocks").select("credits_deducted, created_at, whatsapp_clicked_at, tier_at_unlock, talent_acknowledged_at").eq("id", r.unlock_id).maybeSingle(),
    db.from("recruiters").select("company_name").eq("id", r.recruiter_id).maybeSingle(),
    db.from("ghost_reports").select("id", { count: "exact", head: true }).eq("recruiter_id", r.recruiter_id).gte("created_at", monthStart),
  ]);
  for (const x of [unlock, rec, count]) if (x.error) throw new Error(`admin ghost case failed: ${x.error.message}`);
  return { ...r, unlock: unlock.data as GhostCase["unlock"], recruiter_company: (rec.data as { company_name: string | null } | null)?.company_name ?? null, recruiter_reports_this_month: count.count ?? 0 };
}

export type AttestationCase = {
  id: string;
  channel: string;
  contact_masked: string;
  status: string;
  created_at: string;
  responded_at: string | null;
  project: { generic_title: string; live_url: string; verification_method: string; is_ownership_verified: boolean } | null;
  confirmations_for_contact_30d: number;
};

export async function attestationCase(db: SupabaseClient, id: string): Promise<AttestationCase | null> {
  const a = await db.from("client_attestations").select("id, channel, contact_masked, contact_hmac, status, created_at, responded_at, project_id").eq("id", id).maybeSingle();
  if (a.error) throw new Error(`admin attestation failed: ${a.error.message}`);
  const row = a.data as (AttestationCase & { contact_hmac: string; project_id: string }) | null;
  if (!row) return null;
  const [pr, same] = await Promise.all([
    db.from("projects").select("generic_title, live_url, verification_method, is_ownership_verified").eq("id", row.project_id).maybeSingle(),
    db.from("client_attestations").select("id", { count: "exact", head: true }).eq("contact_hmac", row.contact_hmac).eq("status", "confirmed").gte("responded_at", new Date(Date.now() - 30 * 86_400_000).toISOString()),
  ]);
  for (const x of [pr, same]) if (x.error) throw new Error(`admin attestation failed: ${x.error.message}`);
  const { contact_hmac: _h, project_id: _p, ...safe } = row; // the hash never leaves this function
  void _h; void _p;
  return { ...safe, project: pr.data as AttestationCase["project"], confirmations_for_contact_30d: same.count ?? 0 };
}

export async function recentAudit(db: SupabaseClient, targetId: string): Promise<{ action: string; notes: string | null; created_at: string; admin_id: string | null }[]> {
  return must("audit", await db.from("admin_audit_log").select("action, notes, created_at, admin_id").eq("target_id", targetId).order("created_at", { ascending: false }).limit(10));
}
