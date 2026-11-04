import type { Metadata } from "next";
import { RecruiterOnboardingForm } from "@/components/onboarding/RecruiterOnboardingForm";
import { enforce } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Set up your recruiter account" };

export default async function RecruiterOnboardingPage() {
  await enforce("/onboard/recruiter");
  return <RecruiterOnboardingForm />;
}
