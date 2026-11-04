import "server-only";
import type { User } from "@supabase/supabase-js";
import { cache } from "react";
import { redirect } from "next/navigation";
import { RECRUITER_COLUMNS, TALENT_COLUMNS, TALENT_PRIVATE_COLUMNS } from "@/lib/queries";
import { guard } from "@/lib/routing";
import { createClient } from "@/lib/supabase/server";

export type TalentSummary = {
  id: string;
  role: "developer" | "designer" | "marketer";
  masked_name: string;
  city: string;
  state: string;
  is_listed: boolean;
  is_online: boolean;
  proof_score: number;
  response_velocity_score: number;
  composite_rank_score: number;
  review_status: "unverified" | "reviewed" | "verified";
  state_rank: number | null;
  state_cohort_size: number | null;
};

export type TalentPrivateSummary = {
  phone_e164: string;
  whatsapp_number: string;
  is_phone_verified: boolean;
};

export type RecruiterSummary = {
  id: string;
  company_name: string | null;
  is_phone_verified: boolean;
  credits_balance: number;
  trial_unlocks_remaining: number;
};

export type Viewer = {
  user: User;
  hasGithub: boolean;
  talent: (TalentSummary & { private: TalentPrivateSummary | null }) | null;
  recruiter: RecruiterSummary | null;
};

/** Cheap: just "who is signed in?" (verified with the Auth server, not just read from the cookie). */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

/**
 * Who is signed in AND which profiles do they have? Wrapped in React `cache()` so a page, its
 * layout and any component calling it share ONE set of queries per request.
 *
 * A database error is thrown, never treated as "no profile": otherwise a blip would bounce an
 * existing user into onboarding and invite them to create a second profile.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();

  const [talentRes, recruiterRes] = await Promise.all([
    supabase
      .from("talent_public")
      .select(TALENT_COLUMNS)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("recruiters")
      .select(RECRUITER_COLUMNS)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  if (talentRes.error) throw new Error(`talent lookup failed: ${talentRes.error.message}`);
  if (recruiterRes.error) throw new Error(`recruiter lookup failed: ${recruiterRes.error.message}`);

  let talent: Viewer["talent"] = null;
  if (talentRes.data) {
    const priv = await supabase
      .from("talent_private")
      .select(TALENT_PRIVATE_COLUMNS)
      .eq("talent_id", talentRes.data.id)
      .maybeSingle();
    if (priv.error) throw new Error(`talent_private lookup failed: ${priv.error.message}`);
    talent = { ...(talentRes.data as TalentSummary), private: (priv.data as TalentPrivateSummary | null) ?? null };
  }

  return {
    user,
    hasGithub: (user.identities ?? []).some((i) => i.provider === "github"),
    talent,
    recruiter: (recruiterRes.data as RecruiterSummary | null) ?? null,
  };
});

/**
 * Call at the top of every protected page. Signed out -> /login. Wrong place for this user's
 * profile state -> the right onboarding step / home. Otherwise returns the viewer.
 *
 * This is the "secure" check. The proxy's check is only the quick, optimistic one.
 */
export async function enforce(pathname: string): Promise<Viewer> {
  const viewer = await getViewer();
  // /auth/reset forgets a dead session first (a token for a deleted user would otherwise loop /login <-> /dashboard)
  if (!viewer) redirect(`/auth/reset?next=${encodeURIComponent(pathname)}`);
  const target = guard(pathname, { talent: !!viewer.talent, recruiter: !!viewer.recruiter });
  if (target) redirect(target);
  return viewer;
}

/** Like enforce(), but the return type guarantees a talent profile (no `!` or casts at call sites). */
export async function enforceTalent(pathname: string) {
  const viewer = await enforce(pathname);
  if (!viewer.talent) redirect("/onboard/talent"); // unreachable for talent paths; keeps the types honest
  return { ...viewer, talent: viewer.talent };
}

export async function enforceRecruiter(pathname: string) {
  const viewer = await enforce(pathname);
  if (!viewer.recruiter) redirect("/onboard/recruiter");
  return { ...viewer, recruiter: viewer.recruiter };
}
