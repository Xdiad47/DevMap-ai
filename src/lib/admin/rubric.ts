import { z } from "zod";

/**
 * Designer / marketer work-depth (PRD §7.2): four criteria scored 0-10 by a human, total 0-40, which is what
 * `admin_set_talent_review(talent, tier, work_depth)` takes. `reviewed` = 10 verification points, `verified` = 20.
 */
export const RUBRIC = {
  designer: ["Case-study depth", "Design-system rigour", "Craft & typography", "Range"],
  marketer: ["Documented spend & results", "Regional / vernacular relevance", "Creative quality", "Repeatability"],
} as const;

// A blank field must NOT count as 0 (z.coerce would turn "" into 0), so require real digits.
const scoreMsg = "Enter a whole number from 0 to 10 for every criterion.";
const score = z.union([z.number(), z.string().regex(/^\d{1,2}$/).transform(Number)], { error: scoreMsg }).pipe(z.number({ error: scoreMsg }).int({ error: scoreMsg }).min(0, { error: scoreMsg }).max(10, { error: scoreMsg }));

export const PortfolioDecision = z
  .object({
    talentId: z.string().uuid(),
    queueId: z.string().uuid(),
    tier: z.enum(["unverified", "reviewed", "verified"]),
    s1: score,
    s2: score,
    s3: score,
    s4: score,
    notes: z.string().trim().max(500).default(""),
  })
  .superRefine((v, ctx) => {
    const total = v.s1 + v.s2 + v.s3 + v.s4;
    if (v.tier === "unverified" && v.notes.length < 5) ctx.addIssue({ code: "custom", path: ["notes"], message: "Say why you are rejecting (at least 5 characters): the talent will see it." });
    if (v.tier !== "unverified" && total === 0) ctx.addIssue({ code: "custom", path: ["s1"], message: "An approved portfolio can't score 0 in every criterion." });
  });

/** Rejecting always records work-depth 0 (otherwise rejected profiles would keep points). */
export function workDepth(d: { tier: string; s1: number; s2: number; s3: number; s4: number }): number {
  return d.tier === "unverified" ? 0 : d.s1 + d.s2 + d.s3 + d.s4;
}

export function rubricNotes(role: "designer" | "marketer", d: { s1: number; s2: number; s3: number; s4: number; notes: string }): string {
  const labels = RUBRIC[role];
  const parts = [d.s1, d.s2, d.s3, d.s4].map((s, i) => `${labels[i]} ${s}/10`);
  return `${parts.join(", ")}${d.notes ? `. ${d.notes}` : ""}`.slice(0, 500);
}

const notes = z.string().trim().min(5, "Write a short reason (at least 5 characters). It becomes part of the record.").max(500);
const id = z.string().uuid();

export const GhostDecision = z.object({ reportId: id, queueId: id, decision: z.enum(["uphold", "reject"]), notes });
export const BanDecision = z.object({ talentId: id, queueId: id.optional().or(z.literal("").transform(() => undefined)), decision: z.enum(["ban", "dismiss", "restore"]), notes });
export const AttestationDecision = z.object({ attestationId: id, queueId: id, decision: z.enum(["approve", "reject"]), notes });
export const TalentDecision = z.object({ talentId: id, decision: z.enum(["ban", "restore"]), notes });
