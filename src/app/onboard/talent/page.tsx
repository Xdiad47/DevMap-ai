import type { Metadata } from "next";
import { TalentOnboardingForm, type SkillOption } from "@/components/onboarding/TalentOnboardingForm";
import { enforce } from "@/lib/auth/viewer";
import type { Role } from "@/lib/constants";
import { SKILL_COLUMNS } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Create your talent profile" };

const isRole = (v: unknown): v is Role => v === "developer" || v === "designer" || v === "marketer";

export default async function TalentOnboardingPage({ searchParams }: PageProps<"/onboard/talent">) {
  const viewer = await enforce("/onboard/talent");
  const { role } = await searchParams;

  // `skills` is the public catalogue (anon-readable), so this query needs no special rights.
  const supabase = await createClient();
  const { data, error } = await supabase.from("skills").select(SKILL_COLUMNS).order("sort_order");
  if (error) throw new Error(`could not load skills: ${error.message}`);

  return (
    <TalentOnboardingForm
      skills={(data ?? []) as SkillOption[]}
      defaultEmail={viewer.user.email ?? ""}
      hasGithub={viewer.hasGithub}
      initialRole={isRole(role) ? role : undefined}
    />
  );
}
