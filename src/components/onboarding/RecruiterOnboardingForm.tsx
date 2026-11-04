"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ZodError } from "zod";
import { ConsentDialog } from "@/components/consent/ConsentDialog";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Field, TextInput } from "@/components/ui/field";
import { RECRUITER_CONSENTS } from "@/lib/constants";
import { AppError, friendlyMessage, isProfileExists } from "@/lib/errors";
import { createRecruiterProfile, recordMissingConsents } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/client";
import { buildCreateRecruiterArgs } from "@/lib/validation/recruiter";

/**
 * Beta: one short step (company name, optional GSTIN) and the terms. No phone verification: recruiters open WhatsApp
 * from their own phone, so DevMap never needs their number.
 */
export function RecruiterOnboardingForm() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [companyName, setCompanyName] = useState("");
  const [gstin, setGstin] = useState("");
  const [fieldError, setFieldError] = useState<string>("");
  const [consentOpen, setConsentOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trialGranted, setTrialGranted] = useState<boolean | null>(null);

  function toConsent() {
    try {
      buildCreateRecruiterArgs({ companyName, gstin });
      setFieldError("");
      setError(null);
      setConsentOpen(true);
    } catch (e) {
      setFieldError(e instanceof ZodError ? (e.issues[0]?.message ?? "Check the details") : friendlyMessage(e));
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const args = buildCreateRecruiterArgs({ companyName, gstin });
      const sb = createClient();
      await recordMissingConsents(sb, RECRUITER_CONSENTS);
      try {
        await createRecruiterProfile(sb, args);
      } catch (e) {
        if (!isProfileExists(e)) throw e;
      }

      // The free preview must show up in the credits ledger.
      const { data, error: ledgerError } = await sb.from("credits_ledger").select("reason").eq("reason", "trial_grant");
      setTrialGranted(!ledgerError && (data?.length ?? 0) > 0);
      setConsentOpen(false);
      setStep(2);
      router.refresh();
    } catch (e) {
      setError(e instanceof AppError ? e.message : friendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-xl">
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">{step === 2 ? "All set" : "Step 1 of 1"}</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">
          {step === 1 && "Tell us about your business"}
          {step === 2 && "Your recruiter account is ready"}
        </h1>
        <div className="mt-3 flex gap-1.5" aria-hidden>
          <span className={cn("h-1.5 flex-1 rounded-full bg-emerald-600")} />
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <Field label="Company or agency name (optional)" htmlFor="company" hint="Shown to talent when you unlock them. Leave blank if you're an individual founder.">
            <TextInput id="company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoComplete="organization" />
          </Field>
          <Field label="GSTIN (optional)" htmlFor="gstin" error={fieldError} hint="Only needed if you want a GST invoice.">
            <TextInput id="gstin" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} placeholder="18ABCDE1234F1Z5" />
          </Field>
          <div className="flex justify-end">
            <Button onClick={toConsent}>Continue</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          {trialGranted ? (
            <Alert tone="success">
              <p className="font-medium">🎁 Your free preview is ready.</p>
              <p className="mt-1">
                You can unlock one standard-tier profile for free. Elite (Tier 1) profiles need credits.
              </p>
            </Alert>
          ) : (
            <Alert tone="warn">
              Your account was created, but we couldn&apos;t confirm your free preview yet. It will appear on the next
              screen; if it doesn&apos;t, contact support.
            </Alert>
          )}
          <div className="flex justify-end">
            <Button onClick={() => router.replace("/explore")}>Start exploring</Button>
          </div>
        </div>
      )}

      <ConsentDialog
        open={consentOpen}
        types={RECRUITER_CONSENTS}
        title="One last thing"
        confirmLabel="I agree – create my account"
        busy={busy}
        error={error}
        onCancel={() => setConsentOpen(false)}
        onConfirm={submit}
      />
    </Card>
  );
}
