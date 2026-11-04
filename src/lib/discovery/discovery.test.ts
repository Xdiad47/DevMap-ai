import { describe, expect, it } from "vitest";
import { formatPaise, perCreditPaise } from "@/lib/money";
import { friendlyMessage } from "@/lib/errors";
import { DEFAULT_FILTERS, hasActiveFilters, parseFilters, toSearchParams, type Filters } from "./filters";
import { INTENTS, getIntent } from "./intents";
import { NEARBY_KM, clausesExpression, effectiveClauses, effectiveLanguage, orchestrate, planAttempts } from "./search";

const f = (over: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...over });

describe("parseFilters", () => {
  it("accepts valid values and ignores junk", () => {
    expect(parseFilters({ role: "designer", city: "Surat", language: "Gujarati", online: "1", maxRate: "700" })).toEqual({
      state: "Gujarat", intent: undefined, role: "designer", city: "Surat", language: "Gujarati", online: true, maxRate: 700,
    });
    const junk = parseFilters({ role: "admin", city: "Atlantis", state: "Narnia", language: "Klingon", online: "yes", maxRate: "-5", intent: "hack" });
    expect(junk).toEqual({ state: undefined, intent: undefined, role: undefined, city: undefined, language: undefined, online: false, maxRate: undefined });
  });
  it("rejects values that could break out of a PostgREST filter expression", () => {
    expect(parseFilters({ language: "Hindi),id.neq.x" }).language).toBeUndefined();
    expect(parseFilters({ city: "Surat,role.eq.admin" }).city).toBeUndefined();
    expect(parseFilters({ state: "Gujarat,role.eq.admin" }).state).toBeUndefined();
  });
  it("with no place in the URL the search covers all of India", () => {
    expect(parseFilters({}).state).toBeUndefined();
    expect(parseFilters({}).city).toBeUndefined();
  });
  it("a state on its own is allowed; a city brings its own state with it", () => {
    expect(parseFilters({ state: "Kerala" })).toMatchObject({ state: "Kerala", city: undefined });
    expect(parseFilters({ city: "Kochi" })).toMatchObject({ state: "Kerala", city: "Kochi" });
  });
  it("a city that is not in the chosen state is dropped, never trusted", () => {
    expect(parseFilters({ state: "Kerala", city: "Surat" })).toMatchObject({ state: "Kerala", city: undefined });
  });
  it("an intent overrides a role (they are mutually exclusive)", () => {
    const p = parseFilters({ intent: "app", role: "marketer" });
    expect(p.intent).toBe("app");
    expect(p.role).toBeUndefined();
  });
  it("round-trips through the URL and omits defaults", () => {
    const filters = f({ role: "developer", state: "West Bengal", city: "Kolkata", online: true });
    expect(toSearchParams(filters).toString()).toBe("role=developer&city=Kolkata&online=1"); // the city implies the state
    expect(parseFilters(Object.fromEntries(toSearchParams(filters)))).toEqual({ ...filters, intent: undefined, language: undefined, maxRate: undefined });
    expect(toSearchParams(f({ state: "Kerala" })).toString()).toBe("state=Kerala");
    expect(toSearchParams(DEFAULT_FILTERS).toString()).toBe("");
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters(f({ online: true }))).toBe(true);
    expect(hasActiveFilters(f({ state: "Kerala" }))).toBe(true);
  });
});

describe("Intent Gateway", () => {
  it("has the five intents from the PRD, each mapping only to known roles/skills", () => {
    expect(INTENTS.map((i) => i.id)).toEqual(["website", "app", "design", "ads", "regional-content"]);
    for (const i of INTENTS) expect(i.clauses.length).toBeGreaterThan(0);
  });
  it("'website' means developers (web stack) OR designers (web design)", () => {
    expect(clausesExpression(effectiveClauses(f({ intent: "website" })))).toBe(
      "and(role.eq.developer,skills.ov.{react,nextjs,vue}),and(role.eq.designer,skills.ov.{web-design})",
    );
  });
  it("'app' means mobile developers only", () => {
    expect(clausesExpression(effectiveClauses(f({ intent: "app" })))).toBe("and(role.eq.developer,skills.ov.{flutter,kotlin,swift})");
  });
  it("'content in my language' finds vernacular copywriters, and the language is the user's own choice", () => {
    expect(clausesExpression(effectiveClauses(f({ intent: "regional-content" })))).toBe("and(role.eq.marketer,skills.ov.{vernacular-copywriting})");
    expect(effectiveLanguage(f({ intent: "regional-content" }))).toBeUndefined();
    expect(effectiveLanguage(f({ intent: "regional-content", language: "Tamil" }))).toBe("Tamil");
  });
  it("a plain role filter becomes a role-only clause; no filter means no clause", () => {
    expect(clausesExpression(effectiveClauses(f({ role: "designer" })))).toBe("role.eq.designer");
    expect(clausesExpression(effectiveClauses(f()))).toBeNull();
    expect(getIntent("nope")).toBeUndefined();
  });
});

describe("planAttempts: the steps we MAY try (PRD §9.2)", () => {
  it("with no place and no Online filter there is nothing to relax: all of India is already searched", () => {
    expect(planAttempts(f({ role: "designer" })).map((a) => a.kind)).toEqual(["exact"]);
  });
  it("a state on its own relaxes straight to all of India", () => {
    const plan = planAttempts(f({ state: "Kerala" }));
    expect(plan.map((a) => a.kind)).toEqual(["exact", "anywhere"]);
    expect(plan[1].filters.state).toBeUndefined();
    expect(plan[1].notice).toMatch(/Nobody in Kerala yet/);
  });
  it("order: exact -> nearby (~250 km) -> drop Online (active this week) -> anywhere in India", () => {
    const plan = planAttempts(f({ role: "developer", state: "Maharashtra", city: "Pune", online: true }));
    expect(plan.map((a) => a.kind)).toEqual(["exact", "nearby", "online", "anywhere"]);
    expect(plan[1].filters.city).toBeUndefined();
    expect(plan[1].filters.state).toBeUndefined(); // "nearby" can cross a state border: Pune is near Mumbai, not "in Maharashtra"
    expect(plan[1].filters.online).toBe(true); // still Online-only at the nearby step
    expect(plan[1].options.near).toMatchObject({ km: NEARBY_KM });
    expect(plan[1].options.near!.lat).toBeCloseTo(18.52, 1);
    expect(plan[2].filters.online).toBe(false);
    expect(plan[2].options.activeWithinDays).toBe(7);
    expect(plan[2].options.near).toBeDefined(); // cumulative: still nearby
    expect(plan[3].options.near).toBeUndefined();
    expect(plan[3].filters.state).toBeUndefined();
  });
  it("relaxations are cumulative: once the city is dropped it stays dropped", () => {
    for (const a of planAttempts(f({ state: "West Bengal", city: "Kolkata", online: true })).slice(1)) expect(a.filters.city).toBeUndefined();
  });
  it("NEVER relaxes the language, role or intent: that is the product's promise", () => {
    for (const a of planAttempts(f({ intent: "regional-content", language: "Marathi", state: "Maharashtra", city: "Pune", online: true }))) {
      expect(a.filters.intent).toBe("regional-content");
      expect(a.filters.language).toBe("Marathi");
    }
  });
  it("exact carries no notice; every relaxation carries one that names the truth", () => {
    const plan = planAttempts(f({ state: "Gujarat", city: "Surat", online: true }));
    expect(plan[0].notice).toBeNull();
    for (const a of plan.slice(1)) expect(a.notice).toBeTruthy();
    expect(plan[1].notice).toMatch(/Nobody in Surat yet.*250 km/);
    expect(plan[3].notice).toMatch(/Nobody near Surat yet.*across India.*remote/);
  });
});

describe("orchestrate: which attempt is shown (scripted result counts)", () => {
  const rows = (n: number) => ({ rows: [], total: n });
  /** Runs `orchestrate` with a result count per attempt kind; reports which kinds were actually queried. */
  async function scenario(filters: Filters, counts: Partial<Record<"exact" | "nearby" | "online" | "anywhere", number>>) {
    const queried: string[] = [];
    const chosen = await orchestrate(planAttempts(filters), async (a) => {
      queried.push(a.kind);
      return rows(counts[a.kind] ?? 0);
    });
    return { kind: chosen.attempt.kind, total: chosen.result.total, queried };
  }
  const full = f({ role: "developer", state: "Maharashtra", city: "Pune", online: true });

  it("2+ exact matches: done after one query, nothing relaxed", async () => {
    expect(await scenario(full, { exact: 2 })).toEqual({ kind: "exact", total: 2, queried: ["exact"] });
  });
  it("1 exact match + a city filter: widen to nearby if that finds more people", async () => {
    expect(await scenario(full, { exact: 1, nearby: 4 })).toEqual({ kind: "nearby", total: 4, queried: ["exact", "nearby"] });
  });
  it("1 exact match, widening finds nobody new: keep the exact result and say nothing", async () => {
    expect(await scenario(full, { exact: 1, nearby: 1 })).toEqual({ kind: "exact", total: 1, queried: ["exact", "nearby"] });
  });
  it("1 exact match and NO city filter: do NOT go on to drop 'Online now' (that would be a false notice)", async () => {
    expect(await scenario(f({ role: "developer", online: true }), { exact: 1, online: 9 })).toEqual({ kind: "exact", total: 1, queried: ["exact"] });
  });
  it("nothing found nearby either: only THEN drop 'Online now'", async () => {
    expect(await scenario(full, { exact: 0, nearby: 0, online: 3 })).toEqual({ kind: "online", total: 3, queried: ["exact", "nearby", "online"] });
  });
  it("still nothing: finally look across India", async () => {
    expect(await scenario(full, { exact: 0, nearby: 0, online: 0, anywhere: 2 })).toEqual({ kind: "anywhere", total: 2, queried: ["exact", "nearby", "online", "anywhere"] });
  });
  it("truly nothing anywhere: returns an empty result, honestly", async () => {
    const r = await scenario(full, {});
    expect(r.total).toBe(0);
    expect(r.queried).toEqual(["exact", "nearby", "online", "anywhere"]);
  });
});

describe("money + error copy", () => {
  it("formats paise as rupees", () => {
    expect(formatPaise(9900)).toBe("₹99");
    expect(formatPaise(79900)).toBe("₹799");
    expect(formatPaise(7990)).toBe("₹79.90");
    expect(formatPaise(1234500)).toBe("₹12,345");
    expect(perCreditPaise(24900, 3)).toBe(8300);
  });
  it("unlock error codes become plain language", () => {
    for (const code of ["talent_daily_limit_reached", "insufficient_credits", "talent_unavailable", "unlock_refunded", "cannot_unlock_self"]) {
      const msg = friendlyMessage({ message: code });
      expect(msg).not.toMatch(/_/);
      expect(msg).not.toBe("Something went wrong. Please try again.");
    }
  });
});
