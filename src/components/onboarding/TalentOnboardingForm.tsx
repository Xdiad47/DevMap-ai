"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ZodError } from "zod";
import { ConsentDialog } from "@/components/consent/ConsentDialog";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Field, Select, TextInput } from "@/components/ui/field";
import {
  MAX_SECONDARY_LANGUAGES,
  MAX_SKILLS,
  MIN_HOURLY_RATE_RUPEES,
  ROLES,
  TALENT_CONSENTS,
  type Role,
} from "@/lib/constants";
import { AppError, friendlyMessage, isProfileExists } from "@/lib/errors";
import { STATES, citiesOf } from "@/lib/geo/india";
import { DEFAULT_NATIVE_LANGUAGE, LANGUAGES } from "@/lib/languages";
import { maskName } from "@/lib/names";
import { createTalentProfile, recordMissingConsents } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/client";
import {
  buildCreateTalentArgs,
  TALENT_STEPS,
  validateTalentStep,
  type TalentFormValues,
  type TalentStep,
} from "@/lib/validation/talent";

export type SkillOption = { slug: string; label: string; role: Role; category: string };

const STEP_TITLES: Record<TalentStep, string> = {
  role: "What do you do?",
  about: "About you",
  place: "Where & which language?",
  work: "Skills & rate",
  contact: "How should clients reach you?",
  review: "Review & create profile",
};

export function TalentOnboardingForm({
  skills,
  defaultEmail,
  hasGithub,
  initialRole,
}: {
  skills: SkillOption[];
  defaultEmail: string;
  hasGithub: boolean;
  initialRole?: Role;
}) {
  const router = useRouter();
  // Returning from "Connect GitHub" with ?role=developer jumps past the role step, UNLESS the link did
  // not work: the GitHub prompt lives on step 1, so a developer without GitHub must start there.
  const [stepIndex, setStepIndex] = useState(initialRole && !(initialRole === "developer" && !hasGithub) ? 1 : 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [consentOpen, setConsentOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);

  const [values, setValues] = useState<TalentFormValues>({
    role: (initialRole ?? "") as TalentFormValues["role"],
    fullName: "",
    email: defaultEmail,
    state: "",
    city: "",
    nativeLanguage: DEFAULT_NATIVE_LANGUAGE,
    secondaryLanguages: ["English"],
    skills: [],
    hourlyRate: "",
    whatsapp: "",
    portfolioUrl: "",
  });

  const step = TALENT_STEPS[stepIndex];
  const set = <K extends keyof TalentFormValues>(key: K, value: TalentFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
  };

  const roleSkills = useMemo(() => skills.filter((s) => s.role === values.role), [skills, values.role]);
  const needsGithub = values.role === "developer" && !hasGithub;

  function chooseRole(role: Role) {
    setValues((v) => ({
      ...v,
      role,
      // Skills belong to a role; switching role drops the ones that no longer apply.
      skills: v.skills.filter((slug) => skills.find((s) => s.slug === slug)?.role === role),
    }));
    setErrors({});
  }

  function next() {
    if (needsGithub) return;
    const found = validateTalentStep(step, values);
    setErrors(found);
    if (Object.keys(found).length === 0) setStepIndex((i) => Math.min(i + 1, TALENT_STEPS.length - 1));
  }

  async function connectGithub() {
    setGithubBusy(true);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/onboard/talent?role=developer")}`;
    const { error } = await createClient().auth.linkIdentity({ provider: "github", options: { redirectTo } });
    if (error) {
      setSubmitError(friendlyMessage(error));
      setGithubBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setSubmitError(null);
    try {
      const args = buildCreateTalentArgs(values); // final full validation; throws if anything slipped through
      const sb = createClient(); // browser client: consent rows must carry the USER's IP
      await recordMissingConsents(sb, TALENT_CONSENTS); // consent first…
      try {
        await createTalentProfile(sb, args); // …then data
      } catch (e) {
        if (!isProfileExists(e)) throw e; // double-submit / second tab: treat as success
      }
      router.replace("/dashboard/talent");
      router.refresh();
    } catch (e) {
      setSubmitError(
        e instanceof ZodError ? (e.issues[0]?.message ?? "Please check your answers.") : e instanceof AppError ? e.message : friendlyMessage(e),
      );
      setBusy(false);
    }
  }

  const toggleSkill = (slug: string) => {
    const has = values.skills.includes(slug);
    if (!has && values.skills.length >= MAX_SKILLS) return;
    set("skills", has ? values.skills.filter((s) => s !== slug) : [...values.skills, slug]);
  };
  const toggleLanguage = (lang: string) => {
    const has = values.secondaryLanguages.includes(lang as never);
    if (!has && values.secondaryLanguages.length >= MAX_SECONDARY_LANGUAGES) return;
    set(
      "secondaryLanguages",
      (has ? values.secondaryLanguages.filter((l) => l !== lang) : [...values.secondaryLanguages, lang]) as TalentFormValues["secondaryLanguages"],
    );
  };

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Step {stepIndex + 1} of {TALENT_STEPS.length}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{STEP_TITLES[step]}</h1>
        <div className="mt-3 flex gap-1.5" aria-hidden>
          {TALENT_STEPS.map((s, i) => (
            <span key={s} className={cn("h-1.5 flex-1 rounded-full", i <= stepIndex ? "bg-emerald-600" : "bg-slate-200")} />
          ))}
        </div>
      </div>

      <div className="space-y-5">
        {step === "role" && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {ROLES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => chooseRole(r.value)}
                  aria-pressed={values.role === r.value}
                  className={cn(
                    "rounded-xl border p-4 text-left transition-colors",
                    values.role === r.value ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600" : "border-slate-200 hover:bg-slate-50",
                  )}
                >
                  <span className="block text-sm font-semibold text-slate-900">{r.label}</span>
                  <span className="mt-1 block text-xs text-slate-600">{r.blurb}</span>
                </button>
              ))}
            </div>
            {errors.role && <p className="text-xs font-medium text-red-600">{errors.role}</p>}
            {needsGithub && (
              <Alert tone="warn">
                <p className="font-medium">Developers must connect GitHub.</p>
                <p className="mt-1">
                  We score your real, public work (original repositories and recent commits). We only read public data
                  – never your private code.
                </p>
                <Button className="mt-3" onClick={connectGithub} loading={githubBusy}>
                  Connect GitHub
                </Button>
              </Alert>
            )}
            {values.role === "developer" && hasGithub && <Alert tone="success">GitHub connected ✓</Alert>}
          </>
        )}

        {step === "about" && (
          <>
            <Field label="Full name" htmlFor="fullName" error={errors.fullName}>
              <TextInput
                id="fullName"
                autoComplete="name"
                value={values.fullName}
                onChange={(e) => set("fullName", e.target.value)}
                placeholder="Rahul Sharma"
              />
            </Field>
            <div className="rounded-lg bg-slate-50 p-4 text-sm">
              <p className="text-slate-600">Recruiters will see you as</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{maskName(values.fullName)}</p>
              <p className="mt-1 text-xs text-slate-500">
                Your full name is revealed only after a recruiter pays to unlock your contact.
              </p>
            </div>
            <Field label="Email" htmlFor="email" error={errors.email} hint="Private. Never shown to recruiters.">
              <TextInput id="email" type="email" autoComplete="email" value={values.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
          </>
        )}

        {step === "place" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="State or union territory" htmlFor="state" error={errors.state}>
                <Select
                  id="state"
                  value={values.state}
                  onChange={(e) => {
                    set("state", e.target.value);
                    set("city", ""); // a city only makes sense inside its own state
                  }}
                >
                  <option value="">Choose your state</option>
                  {STATES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label="City" htmlFor="city" error={errors.city} hint="We only store the city centre, never your address.">
                <Select id="city" value={values.city} disabled={!values.state} onChange={(e) => set("city", e.target.value)}>
                  <option value="">{values.state ? "Choose your city" : "Choose a state first"}</option>
                  {citiesOf(values.state).map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="text-xs text-slate-500">Don&apos;t see your city? Pick the nearest one. Recruiters can still find you, and most work is remote.</p>
            <Field label="Native language" htmlFor="native" error={errors.nativeLanguage} hint="Clients filter by this.">
              <Select
                id="native"
                value={values.nativeLanguage}
                onChange={(e) => set("nativeLanguage", e.target.value as TalentFormValues["nativeLanguage"])}
              >
                {LANGUAGES.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </Select>
            </Field>
            <fieldset>
              <legend className="text-sm font-medium text-slate-800">
                Other languages you work in{" "}
                <span className="font-normal text-slate-500">
                  ({values.secondaryLanguages.length}/{MAX_SECONDARY_LANGUAGES})
                </span>
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {LANGUAGES.filter((l) => l !== values.nativeLanguage).map((l) => (
                  <Chip key={l} on={values.secondaryLanguages.includes(l)} onClick={() => toggleLanguage(l)}>
                    {l}
                  </Chip>
                ))}
              </div>
              {errors.secondaryLanguages && <p className="mt-1 text-xs font-medium text-red-600">{errors.secondaryLanguages}</p>}
            </fieldset>
          </>
        )}

        {step === "work" && (
          <>
            <fieldset>
              <legend className="text-sm font-medium text-slate-800">
                Your skills{" "}
                <span className="font-normal text-slate-500">
                  ({values.skills.length}/{MAX_SKILLS})
                </span>
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {roleSkills.map((s) => (
                  <Chip key={s.slug} on={values.skills.includes(s.slug)} onClick={() => toggleSkill(s.slug)}>
                    {s.label}
                  </Chip>
                ))}
              </div>
              {errors.skills && <p className="mt-1 text-xs font-medium text-red-600">{errors.skills}</p>}
            </fieldset>
            <Field
              label="Your rate (₹ per hour)"
              htmlFor="rate"
              error={errors.hourlyRate}
              hint={`Minimum ₹${MIN_HOURLY_RATE_RUPEES}/hr. Shown on your card; you negotiate the final price directly.`}
            >
              <div className="flex gap-2">
                <span className="inline-flex items-center rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-600">₹</span>
                <TextInput
                  id="rate"
                  inputMode="numeric"
                  value={values.hourlyRate}
                  onChange={(e) => set("hourlyRate", e.target.value.replace(/\D/g, ""))}
                  placeholder="600"
                />
              </div>
            </Field>
          </>
        )}

        {step === "contact" && (
          <>
            <Field
              label="WhatsApp number"
              htmlFor="whatsapp"
              error={errors.whatsapp}
              hint="Hidden until a recruiter pays to unlock you. This is where they will message you."
            >
              <div className="flex gap-2">
                <span className="inline-flex items-center rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-600">+91</span>
                <TextInput
                  id="whatsapp"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={values.whatsapp}
                  onChange={(e) => set("whatsapp", e.target.value)}
                  placeholder="98765 43210"
                />
              </div>
            </Field>
            <Field
              label="Portfolio link (optional)"
              htmlFor="portfolio"
              error={errors.portfolioUrl}
              hint="Revealed only after a recruiter unlocks you."
            >
              <TextInput
                id="portfolio"
                type="url"
                value={values.portfolioUrl}
                onChange={(e) => set("portfolioUrl", e.target.value)}
                placeholder="https://your-portfolio.com"
              />
            </Field>
          </>
        )}

        {step === "review" && (
          <>
            <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              <Row label="Shown as" value={maskName(values.fullName)} />
              <Row label="Role" value={ROLES.find((r) => r.value === values.role)?.label ?? "–"} />
              <Row label="Location" value={`${values.city}, ${values.state}`} />
              <Row label="Languages" value={[values.nativeLanguage, ...values.secondaryLanguages.filter((l) => l !== values.nativeLanguage)].join(", ")} />
              <Row label="Skills" value={roleSkills.filter((s) => values.skills.includes(s.slug)).map((s) => s.label).join(", ") || "–"} />
              <Row label="Rate" value={`₹${values.hourlyRate}/hr`} />
              <Row label="WhatsApp (hidden)" value={`+91 ${values.whatsapp}`} />
            </dl>
            <Alert tone="info">
              Next you&apos;ll agree to how we use your data. You appear on the map once your work is scored (a live project or a GitHub history),
              or once our team has reviewed your portfolio. Recruiters tap your WhatsApp number only after they unlock you.
            </Alert>
          </>
        )}

        {submitError && !consentOpen && <Alert tone="error">{submitError}</Alert>}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" onClick={() => setStepIndex((i) => Math.max(0, i - 1))} disabled={stepIndex === 0 || busy}>
          Back
        </Button>
        {step !== "review" ? (
          <Button onClick={next} disabled={needsGithub || (step === "role" && !values.role)}>
            Continue
          </Button>
        ) : (
          <Button onClick={() => setConsentOpen(true)}>Review consent &amp; create profile</Button>
        )}
      </div>

      <ConsentDialog
        open={consentOpen}
        types={TALENT_CONSENTS}
        title="Before we create your profile"
        confirmLabel="I agree – create my profile"
        busy={busy}
        error={submitError}
        onCancel={() => setConsentOpen(false)}
        onConfirm={submit}
      />
    </Card>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm transition-colors",
        on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-2.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value}</dd>
    </div>
  );
}
