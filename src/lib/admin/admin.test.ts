import { describe, expect, it } from "vitest";
import { isProtectedPath, guard } from "@/lib/routing";
import { parseEvidence } from "./evidence";
import { isAdminUser } from "./guard";
import { AttestationDecision, BanDecision, GhostDecision, PortfolioDecision, rubricNotes, workDepth } from "./rubric";

describe("isAdminUser", () => {
  it("only app_metadata.role === 'admin' counts", () => {
    expect(isAdminUser({ app_metadata: { role: "admin" } })).toBe(true);
    for (const u of [null, undefined, {}, { app_metadata: null }, { app_metadata: {} }, { app_metadata: { role: "user" } }, { app_metadata: { role: "Admin" } }, { app_metadata: { roles: ["admin"] } }, { app_metadata: { role: ["admin"] } }]) {
      expect(isAdminUser(u as never)).toBe(false);
    }
  });
  it("ignores user_metadata, which the user can edit themselves", () => {
    expect(isAdminUser({ user_metadata: { role: "admin" } } as never)).toBe(false);
  });
});

describe("routing", () => {
  it("/admin requires a session at the proxy, and has no profile requirement", () => {
    expect(isProtectedPath("/admin")).toBe(true);
    expect(isProtectedPath("/admin/review-queue/abc")).toBe(true);
    expect(isProtectedPath("/administrator")).toBe(false);
    expect(guard("/admin/review-queue", { talent: false, recruiter: false })).toBeNull();
  });
});

describe("parseEvidence", () => {
  it("keeps plain links as links", () => {
    const e = parseEvidence(["https://wa.me/x?y=1"]);
    expect(e[0]).toEqual({ kind: "link", url: "https://wa.me/x?y=1" });
  });
  it("anything suspicious is inert text, not a link", () => {
    const e = parseEvidence(["javascript:alert(1)", "telegram:photo:../../etc/passwd", "data:text/html,<script>", "<img src=x onerror=alert(1)>"]);
    expect(e.every((x) => x.kind === "text")).toBe(true);
  });
  it("tolerates null", () => expect(parseEvidence(null)).toEqual([]));
});

const base = { talentId: "3f2a1c4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b", queueId: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" };

describe("PortfolioDecision", () => {
  it("coerces form strings and sums the rubric", () => {
    const d = PortfolioDecision.parse({ ...base, tier: "reviewed", s1: "8", s2: "7", s3: "9", s4: "6", notes: "" });
    expect(workDepth(d)).toBe(30);
  });
  it("rejecting records 0 work-depth whatever the sliders say", () => {
    const d = PortfolioDecision.parse({ ...base, tier: "unverified", s1: "8", s2: "8", s3: "8", s4: "8", notes: "stock images only" });
    expect(workDepth(d)).toBe(0);
  });
  it("rejecting requires a reason (the talent sees it)", () => {
    expect(PortfolioDecision.safeParse({ ...base, tier: "unverified", s1: "0", s2: "0", s3: "0", s4: "0", notes: "" }).success).toBe(false);
  });
  it("approving with all zeros is refused (that is a rejection)", () => {
    expect(PortfolioDecision.safeParse({ ...base, tier: "reviewed", s1: "0", s2: "0", s3: "0", s4: "0" }).success).toBe(false);
  });
  it.each([["11"], ["-1"], ["2.5"], ["abc"], [""]])("rejects a score of %j", (v) => {
    expect(PortfolioDecision.safeParse({ ...base, tier: "reviewed", s1: v, s2: "5", s3: "5", s4: "5" }).success).toBe(false);
  });
  it("rejects an unknown tier and a non-uuid id", () => {
    expect(PortfolioDecision.safeParse({ ...base, tier: "admin", s1: "5", s2: "5", s3: "5", s4: "5" }).success).toBe(false);
    expect(PortfolioDecision.safeParse({ ...base, talentId: "x", tier: "reviewed", s1: "5", s2: "5", s3: "5", s4: "5" }).success).toBe(false);
  });
  it("the stored note names each criterion for the role and stays within 500 chars", () => {
    const n = rubricNotes("designer", { s1: 8, s2: 7, s3: 9, s4: 6, notes: "great" });
    expect(n).toBe("Case-study depth 8/10, Design-system rigour 7/10, Craft & typography 9/10, Range 6/10. great");
    expect(rubricNotes("marketer", { s1: 1, s2: 2, s3: 3, s4: 4, notes: "x".repeat(900) }).length).toBe(500);
  });
});

describe("other decisions require a real reason and valid ids", () => {
  const rep = { reportId: base.talentId, queueId: base.queueId };
  it("ghost", () => {
    expect(GhostDecision.safeParse({ ...rep, decision: "uphold", notes: "no reply visible" }).success).toBe(true);
    expect(GhostDecision.safeParse({ ...rep, decision: "uphold", notes: "ok" }).success).toBe(false);
    expect(GhostDecision.safeParse({ ...rep, decision: "refund", notes: "no reply visible" }).success).toBe(false);
  });
  it("ban: queue id is optional (talent page) but must be a uuid when present", () => {
    expect(BanDecision.safeParse({ talentId: base.talentId, decision: "ban", notes: "fabricated work" }).success).toBe(true);
    expect(BanDecision.safeParse({ talentId: base.talentId, queueId: "", decision: "restore", notes: "appeal accepted" }).success).toBe(true);
    expect(BanDecision.safeParse({ talentId: base.talentId, queueId: "nope", decision: "ban", notes: "fabricated work" }).success).toBe(false);
  });
  it("attestation", () => {
    expect(AttestationDecision.safeParse({ attestationId: base.talentId, queueId: base.queueId, decision: "reject", notes: "client denies it" }).success).toBe(true);
    expect(AttestationDecision.safeParse({ attestationId: base.talentId, queueId: base.queueId, decision: "maybe", notes: "client denies it" }).success).toBe(false);
  });
});
