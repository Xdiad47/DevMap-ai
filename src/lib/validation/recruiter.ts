import { z } from "zod";

/** Same pattern as the `recruiters.gstin` CHECK constraint in the migration. */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const recruiterFieldsSchema = z.object({
  companyName: z.string().trim().max(100, "Keep it under 100 characters"),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || GSTIN.test(v), "That doesn't look like a valid GSTIN (15 characters)"),
});

export type RecruiterFormValues = z.infer<typeof recruiterFieldsSchema>;

/** Exact argument names of `public.create_recruiter_profile(...)`. */
export type CreateRecruiterArgs = {
  p_phone_e164: null; // beta: recruiters give no number (they open WhatsApp from their own phone)
  p_company_name: string | null;
  p_gstin: string | null;
};

export function buildCreateRecruiterArgs(input: RecruiterFormValues): CreateRecruiterArgs {
  const v = recruiterFieldsSchema.parse(input);
  return {
    p_phone_e164: null,
    p_company_name: v.companyName || null,
    p_gstin: v.gstin || null,
  };
}
