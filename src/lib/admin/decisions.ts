import type { SupabaseClient } from "@supabase/supabase-js";
import { rawMessage } from "@/lib/errors";
import { AttestationDecision, BanDecision, GhostDecision, PortfolioDecision, rubricNotes, TalentDecision, workDepth } from "./rubric";

/**
 * What each admin form does once the caller is known to be an admin: validate, then call the database function.
 * `sb` is the admin's OWN session client (so reviewer_id / the audit log name the person); `db` the service client
 * (read-only use). The server actions in src/app/admin/actions.ts are thin wrappers, so this is what the contract tests run.
 */
export type Outcome = { ok: true; group: "portfolio" | "ghost" | "ban" | "attestation"; talentId?: string } | { error: string };

const ERRORS: [string, string][] = [
  ["forbidden", "Your session doesn't carry the admin role yet (it was issued before you were made admin). Sign out and sign back in."],
  ["talent_not_found", "That profile no longer exists."],
  ["report_not_found", "That report no longer exists."],
  ["review_item_not_open", "Someone already resolved this item."],
  ["attestation_not_found", "That attestation no longer exists."],
  ["work_depth_out_of_range", "Work depth must be between 0 and 40."],
];
export const explain = (e: unknown) => ERRORS.find(([m]) => rawMessage(e).includes(m))?.[1] ?? "The database refused this action. Reload and check the item's current state.";
const issue = (err: { issues: { message: string }[] }): Outcome => ({ error: err.issues[0]?.message ?? "Check the form." });

export async function portfolioDecision(sb: SupabaseClient, db: SupabaseClient, input: unknown): Promise<Outcome> {
  const p = PortfolioDecision.safeParse(input);
  if (!p.success) return issue(p.error);
  const d = p.data;
  const role = ((await db.from("talent_public").select("role").eq("id", d.talentId).maybeSingle()).data as { role?: string } | null)?.role;
  if (role !== "designer" && role !== "marketer") return { error: "Only designers and marketers are reviewed by hand." };
  const { error } = await sb.rpc("admin_set_talent_review", {
    p_talent: d.talentId, p_status: d.tier, p_work_depth: workDepth(d), p_notes: rubricNotes(role, d), p_queue_id: d.queueId,
  });
  return error ? { error: explain(error) } : { ok: true, group: "portfolio" };
}

export async function ghostDecision(sb: SupabaseClient, input: unknown): Promise<Outcome> {
  const p = GhostDecision.safeParse(input);
  if (!p.success) return issue(p.error);
  const { error } = await sb.rpc("admin_resolve_ghost_report", { p_report: p.data.reportId, p_uphold: p.data.decision === "uphold", p_notes: p.data.notes, p_queue_id: p.data.queueId });
  return error ? { error: explain(error) } : { ok: true, group: "ghost" };
}

export async function banDecision(sb: SupabaseClient, input: unknown): Promise<Outcome> {
  const p = BanDecision.safeParse(input);
  if (!p.success) return issue(p.error);
  const { talentId, queueId, decision, notes } = p.data;
  if (decision === "dismiss" && !queueId) return { error: "Nothing to dismiss: this isn't a queue item." };
  const { error } =
    decision === "ban" ? await sb.rpc("admin_ban_talent", { p_talent: talentId, p_notes: notes, p_queue_id: queueId ?? null })
    : decision === "restore" ? await sb.rpc("admin_restore_talent", { p_talent: talentId, p_notes: notes })
    : await sb.rpc("admin_dismiss_ban_review", { p_queue_id: queueId, p_notes: notes });
  return error ? { error: explain(error) } : { ok: true, group: "ban" };
}

export async function attestationDecision(sb: SupabaseClient, input: unknown): Promise<Outcome> {
  const p = AttestationDecision.safeParse(input);
  if (!p.success) return issue(p.error);
  const { error } = await sb.rpc("admin_review_attestation", { p_attestation: p.data.attestationId, p_approve: p.data.decision === "approve", p_notes: p.data.notes, p_queue_id: p.data.queueId });
  return error ? { error: explain(error) } : { ok: true, group: "attestation" };
}

export async function talentDecision(sb: SupabaseClient, input: unknown): Promise<Outcome> {
  const p = TalentDecision.safeParse(input);
  if (!p.success) return issue(p.error);
  const { talentId, decision, notes } = p.data;
  const { error } = decision === "ban"
    ? await sb.rpc("admin_ban_talent", { p_talent: talentId, p_notes: notes, p_queue_id: null })
    : await sb.rpc("admin_restore_talent", { p_talent: talentId, p_notes: notes });
  return error ? { error: explain(error) } : { ok: true, group: "ban", talentId };
}
