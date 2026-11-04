/** Bump this when the Terms / Privacy text changes; it is stored with every consent row (DPDP evidence). */
export const POLICY_VERSION = "2026-11-04";

export const MIN_HOURLY_RATE_RUPEES = 300; // DB: hourly_rate_paise >= 30000
export const MAX_SKILLS = 12; // DB: cardinality(skills) <= 12
export const MAX_SECONDARY_LANGUAGES = 5;

export type Role = "developer" | "designer" | "marketer";
export const ROLES: { value: Role; label: string; blurb: string }[] = [
  { value: "developer", label: "Developer", blurb: "Web, mobile or backend engineer. Sign in with GitHub." },
  { value: "designer", label: "UI/UX Designer", blurb: "Product, web or mobile design. Reviewed by our team." },
  { value: "marketer", label: "Digital Marketer", blurb: "Performance, SEO or vernacular growth. Reviewed by our team." },
];

export type ConsentType =
  | "dpdp_directory_listing"
  | "contact_disclosure"
  | "phone_processing"
  | "recruiter_terms";

export const TALENT_CONSENTS: ConsentType[] = [
  "dpdp_directory_listing",
  "contact_disclosure",
  "phone_processing",
];
export const RECRUITER_CONSENTS: ConsentType[] = ["recruiter_terms"];

export const CONSENT_COPY: Record<ConsentType, { title: string; body: string }> = {
  dpdp_directory_listing: {
    title: "List me in the public directory",
    body: "Show my first name and last initial, city, languages, skills, rate, scores and rank on DevMap. My full name, phone, email and links stay hidden.",
  },
  contact_disclosure: {
    title: "Share my contact with recruiters who pay",
    body: "When a recruiter pays to unlock me, reveal my full name, WhatsApp number and verified project links to them.",
  },
  phone_processing: {
    title: "Process my phone number",
    body: "Store the WhatsApp number I enter and show it only to recruiters who pay to unlock me. I can withdraw this consent any time, which hides my profile.",
  },
  recruiter_terms: {
    title: "Recruiter terms",
    body: "I will use unlocked contact details only to discuss genuine work with that person, and I will not resell, share or mass-message them.",
  },
};
