import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "@/lib/url";
import { costFor, unlockAction } from "./unlock-action";

const std = { quote: { tier: "standard" as const, credits: 1 }, is_at_daily_cap: false };
const elite = { quote: { tier: "top_tier" as const, credits: 2 }, is_at_daily_cap: false };

describe("unlockAction (the card button)", () => {
  it("standard = 1 credit, elite = 2 credits", () => {
    expect(unlockAction(std, "none", 0).label).toBe("Unlock · 1 credit");
    expect(unlockAction(elite, "none", 0).label).toBe("Unlock · 2 credits");
  });
  it("the free preview applies to STANDARD profiles only, never to elite", () => {
    expect(unlockAction(std, "none", 1).label).toBe("Unlock free (preview)");
    expect(unlockAction(elite, "none", 1).label).toBe("Unlock · 2 credits");
  });
  it("already unlocked -> view contact (free); refunded -> closed; daily cap -> disabled; no quote -> disabled", () => {
    expect(unlockAction(std, "unlocked", 0)).toMatchObject({ label: "View contact", disabled: false });
    expect(unlockAction(std, "refunded", 0)).toMatchObject({ label: "Refunded", disabled: true });
    expect(unlockAction({ ...std, is_at_daily_cap: true }, "none", 0)).toMatchObject({ label: "Daily limit reached", disabled: true });
    expect(unlockAction({ quote: null, is_at_daily_cap: false }, "none", 0).disabled).toBe(true);
  });
  it("an already-unlocked profile stays viewable even when it is now at its daily cap", () => {
    expect(unlockAction({ ...std, is_at_daily_cap: true }, "unlocked", 0).disabled).toBe(false);
  });
});

describe("costFor", () => {
  it("trial only for standard", () => {
    expect(costFor({ tier: "standard", credits: 1 }, 1)).toEqual({ free: true, credits: 0 });
    expect(costFor({ tier: "standard", credits: 1 }, 0)).toEqual({ free: false, credits: 1 });
    expect(costFor({ tier: "top_tier", credits: 2 }, 1)).toEqual({ free: false, credits: 2 });
  });
});

describe("safeHttpUrl", () => {
  it("allows http(s) and blocks script/data/file URLs", () => {
    expect(safeHttpUrl("https://me.dev/work")).toBe("https://me.dev/work");
    expect(safeHttpUrl("  http://x.in ")).toBe("http://x.in/");
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "ftp://x.in", "//evil", "not a url", 42, null, undefined]) {
      expect(safeHttpUrl(bad)).toBeNull();
    }
  });
});
