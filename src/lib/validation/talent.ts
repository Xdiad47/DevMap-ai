import { z } from "zod";
import { MAX_SECONDARY_LANGUAGES, MAX_SKILLS, MIN_HOURLY_RATE_RUPEES } from "@/lib/constants";
import { STATES, findCity } from "@/lib/geo/india";
import { LANGUAGES } from "@/lib/languages";
import { normalizeIndianMobile } from "@/lib/phone";

/**
 * One schema, two jobs: (1) per-step validation in the form, (2) a final full check right
 * before we call the database. The database re-checks everything anyway (constraints + RPC),
 * so this exists for fast, friendly feedback, not for security.
 */
const indianMobile = z
  .string()
  .refine((v) => normalizeIndianMobile(v) !== null, "Enter a valid 10-digit Indian mobile number");

export const talentFieldsSchema = z.object({
  role: z.enum(["developer", "designer", "marketer"], { error: "Choose what you do" }),
  fullName: z
    .string()
    .trim()
    .min(2, "Enter your full name")
    .max(80, "That name is too long")
    .regex(/\p{L}/u, "Use your real name"),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  state: z.string().refine((s) => STATES.includes(s), "Choose your state"),
  city: z.string().refine((c) => !!findCity(c), "Choose your city"),
  nativeLanguage: z.enum(LANGUAGES, { error: "Choose your native language" }),
  secondaryLanguages: z.array(z.enum(LANGUAGES)).max(MAX_SECONDARY_LANGUAGES, `Pick at most ${MAX_SECONDARY_LANGUAGES}`),
  skills: z
    .array(z.string())
    .min(1, "Pick at least one skill")
    .max(MAX_SKILLS, `Pick at most ${MAX_SKILLS} skills`),
  hourlyRate: z
    .string()
    .trim()
    .regex(/^\d+$/, "Enter a whole number of rupees")
    .refine((v) => Number(v) >= MIN_HOURLY_RATE_RUPEES, `Minimum rate is ₹${MIN_HOURLY_RATE_RUPEES}/hr`)
    .refine((v) => Number(v) <= 100000, "That rate looks too high"),
  whatsapp: indianMobile,
  portfolioUrl: z
    .string()
    .trim()
    .refine((v) => v === "" || /^https:\/\/[^\s/]+\.[^\s/]+(\/\S*)?$/.test(v), "Use a full https:// link, or leave blank"),
}).superRefine((v, ctx) => {
  // The city must really be in the chosen state (the form only offers matching cities; this catches a hand-built payload).
  const city = findCity(v.city);
  if (city && STATES.includes(v.state) && city.state !== v.state) ctx.addIssue({ code: "custom", path: ["city"], message: `Choose a city in ${v.state}` });
});

export type TalentFormValues = z.infer<typeof talentFieldsSchema>;

export const TALENT_STEPS = ["role", "about", "place", "work", "contact", "review"] as const;
export type TalentStep = (typeof TALENT_STEPS)[number];

const stepFields: Record<TalentStep, (keyof TalentFormValues)[]> = {
  role: ["role"],
  about: ["fullName", "email"],
  place: ["state", "city", "nativeLanguage", "secondaryLanguages"],
  work: ["skills", "hourlyRate"],
  contact: ["whatsapp", "portfolioUrl"],
  review: [],
};

/** Returns { fieldName: message } for the fields that belong to `step` only. */
export function validateTalentStep(step: TalentStep, values: TalentFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  const result = talentFieldsSchema.safeParse(values);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (stepFields[step].includes(key as keyof TalentFormValues) && !errors[key]) errors[key] = issue.message;
    }
  }
  return errors;
}

/** Exact argument names of `public.create_talent_profile(...)` in the migration. */
export type CreateTalentArgs = {
  p_role: "developer" | "designer" | "marketer";
  p_full_name: string;
  p_city: string;
  p_state: string;
  p_latitude: number;
  p_longitude: number;
  p_native_language: string;
  p_secondary_languages: string[];
  p_skills: string[];
  p_hourly_rate_paise: number;
  p_phone_e164: string;
  p_whatsapp_number: string;
  p_email: string;
  p_portfolio_links: string[];
};

export function buildCreateTalentArgs(input: TalentFormValues): CreateTalentArgs {
  const v = talentFieldsSchema.parse(input);
  const city = findCity(v.city)!; // schema already proved it exists
  const whatsapp = normalizeIndianMobile(v.whatsapp)!;
  const phone = whatsapp; // beta: no OTP, so the WhatsApp number is the one contact number (self-declared)
  return {
    p_role: v.role,
    p_full_name: v.fullName,
    p_city: city.name,
    p_state: v.state,
    p_latitude: city.lat,
    p_longitude: city.lng,
    p_native_language: v.nativeLanguage,
    p_secondary_languages: v.secondaryLanguages.filter((l) => l !== v.nativeLanguage),
    p_skills: v.skills,
    p_hourly_rate_paise: Number(v.hourlyRate) * 100, // rupees -> paise (bigint in the DB)
    p_phone_e164: phone,
    p_whatsapp_number: whatsapp,
    p_email: v.email,
    p_portfolio_links: v.portfolioUrl ? [v.portfolioUrl] : [],
  };
}
