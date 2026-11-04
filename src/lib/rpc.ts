import type { SupabaseClient } from "@supabase/supabase-js";
import { POLICY_VERSION, type ConsentType } from "@/lib/constants";
import { AppError, friendlyMessage, rawMessage } from "@/lib/errors";
import { CONSENT_COLUMNS } from "@/lib/queries";
import type { CreateRecruiterArgs } from "@/lib/validation/recruiter";
import type { CreateTalentArgs } from "@/lib/validation/talent";

/**
 * Thin, typed wrappers over the migration's RPCs. Every function name and argument name
 * here must match supabase/migrations/20261102000000_devmap_v2_1_init.sql exactly; the
 * contract test (src/lib/rpc.contract.test.ts) runs these against the real SQL.
 *
 * They take the client as a parameter so the same code works from the browser client
 * (consents MUST use it: the DB logs the caller's IP, and a server-side call would log
 * our server's IP instead) and from server code.
 */
type Sb = SupabaseClient;

function fail(error: { message: string }): never {
  throw new AppError(friendlyMessage(error), error.message);
}

/** Records only the consents the user hasn't already given (re-running onboarding stays idempotent). */
export async function recordMissingConsents(sb: Sb, types: ConsentType[]): Promise<void> {
  const { data, error } = await sb.from("consents").select(CONSENT_COLUMNS);
  if (error) fail(error);
  const active = new Set((data ?? []).filter((c) => c.withdrawn_at === null).map((c) => c.consent_type as string));
  for (const type of types) {
    if (active.has(type)) continue;
    const res = await sb.rpc("record_consent", { p_type: type, p_policy_version: POLICY_VERSION });
    if (res.error) fail(res.error);
  }
}

export async function createTalentProfile(sb: Sb, args: CreateTalentArgs): Promise<string> {
  const { data, error } = await sb.rpc("create_talent_profile", args);
  if (error) fail(error);
  return data as string;
}

export async function createRecruiterProfile(sb: Sb, args: CreateRecruiterArgs): Promise<string> {
  const { data, error } = await sb.rpc("create_recruiter_profile", args);
  if (error) fail(error);
  return data as string;
}

export type PhoneSync = { talent_verified: boolean; recruiter_verified: boolean };

export async function syncPhoneVerification(sb: Sb): Promise<PhoneSync> {
  const { data, error } = await sb.rpc("sync_phone_verification");
  if (error) fail(error);
  return data as PhoneSync;
}


export type AddedProject = {
  project_id: string;
  verification_token: string;
  verify_file_path: string;
  verify_file_content: string;
};

export async function addProject(sb: Sb, title: string, liveUrl: string, repoUrl?: string): Promise<AddedProject> {
  const { data, error } = await sb.rpc("add_project", {
    p_title: title,
    p_live_url: liveUrl,
    p_repo_url: repoUrl || null,
  });
  if (error) {
    const raw = rawMessage(error);
    // Order matters: the duplicate-key message also contains the text "live_url", so test the specific
    // constraint names (see the migration) rather than a column name.
    if (raw.includes("projects_talent_id_live_url_key")) throw new AppError("You already added that URL.", raw);
    if (raw.includes("projects_live_url_check")) {
      throw new AppError("Use a full https:// address without a port or login in it.", raw);
    }
    if (raw.includes("project_limit_reached")) throw new AppError("You can add up to 5 projects.", raw);
    fail(error);
  }
  return data as AddedProject;
}

// ---- after the unlock (Sprint 3) ----

/** Records the click (needed before a rating or report is possible) and returns the wa.me link. */
export async function openWhatsapp(sb: Sb, talentId: string): Promise<string> {
  const { data, error } = await sb.rpc("open_whatsapp", { p_talent_id: talentId });
  if (error) fail(error);
  return data as string;
}

export async function submitLeadFeedback(sb: Sb, talentId: string, rating: "responsive" | "not_fit"): Promise<void> {
  const { error } = await sb.rpc("submit_lead_feedback", { p_talent_id: talentId, p_rating: rating });
  if (error) fail(error);
}

/** Returns the new report's id. */
export async function reportGhosting(sb: Sb, talentId: string, note: string): Promise<string> {
  const { data, error } = await sb.rpc("report_ghosting", { p_talent_id: talentId, p_note: note.trim() ? note.trim().slice(0, 500) : null });
  if (error) fail(error);
  return data as string;
}
