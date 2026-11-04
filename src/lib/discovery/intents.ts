import type { Role } from "@/lib/constants";

/**
 * Intent Gateway (PRD §9.1): non-technical founders don't know "Flutter vs Kotlin". They say what
 * they need; we translate it into role + skill filters. Configuration lives in code, not the database.
 *
 * A website needs developers OR web designers, so an intent is a list of (role, skills) clauses joined by OR.
 */
export type IntentClause = { role: Role; skills: string[] };
export type Intent = { id: IntentId; label: string; hint: string; clauses: IntentClause[]; language?: string };

export const INTENT_IDS = ["website", "app", "design", "ads", "regional-content"] as const;
export type IntentId = (typeof INTENT_IDS)[number];

export const INTENTS: Intent[] = [
  {
    id: "website",
    label: "I need a website",
    hint: "Web developers and web designers",
    clauses: [
      { role: "developer", skills: ["react", "nextjs", "vue"] },
      { role: "designer", skills: ["web-design"] },
    ],
  },
  {
    id: "app",
    label: "I need an Android / iOS app",
    hint: "Mobile developers",
    clauses: [{ role: "developer", skills: ["flutter", "kotlin", "swift"] }],
  },
  {
    id: "design",
    label: "I need a logo / app design",
    hint: "UI/UX designers",
    clauses: [{ role: "designer", skills: ["figma", "mobile-app-design", "design-systems"] }],
  },
  {
    id: "ads",
    label: "I need ads / more customers",
    hint: "Performance and SEO marketers",
    clauses: [{ role: "marketer", skills: ["meta-ads", "google-ads", "seo"] }],
  },
  {
    id: "regional-content",
    label: "I need content in my language",
    hint: "Vernacular copywriters. Pick the language next.",
    clauses: [{ role: "marketer", skills: ["vernacular-copywriting"] }],
  },
];

export function getIntent(id: string | undefined | null): Intent | undefined {
  return INTENTS.find((i) => i.id === id);
}
