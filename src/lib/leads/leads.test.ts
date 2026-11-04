import { describe, expect, it } from "vitest";
import { leadView, reportStatusLine, type LeadRow } from "./status";

const T0 = new Date("2026-11-10T10:00:00Z");
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000).toISOString();
const lead = (over: Partial<LeadRow> = {}): LeadRow => ({
  id: "u1", talent_id: "t1", created_at: hours(-30), is_trial: false, credits_deducted: 1,
  has_clicked_whatsapp: true, whatsapp_clicked_at: hours(-26), refunded_at: null, ...over,
});

describe("leadView", () => {
  it("before opening WhatsApp: no rating, no report, and it says why", () => {
    const v = leadView(lead({ has_clicked_whatsapp: false, whatsapp_clicked_at: null }), null, null, T0);
    expect(v).toMatchObject({ canRate: false, canReport: false });
    expect(v.reportHint).toMatch(/Open WhatsApp first/);
  });
  it("after opening WhatsApp the recruiter can rate, but must wait 24h to report", () => {
    const v = leadView(lead({ whatsapp_clicked_at: hours(-2) }), null, null, T0);
    expect(v.canRate).toBe(true);
    expect(v.canReport).toBe(false);
    expect(v.reportHint).toMatch(/from .* IST \(24 hours after you opened WhatsApp\)/);
  });
  it("exactly 24h after the click the report unlocks (matches the SQL `now() < clicked + 24h` check)", () => {
    expect(leadView(lead({ whatsapp_clicked_at: hours(-24) }), null, null, T0).canReport).toBe(true);
    expect(leadView(lead({ whatsapp_clicked_at: hours(-23.99) }), null, null, T0).canReport).toBe(false);
  });
  it("closes 7 days after the unlock", () => {
    const old = lead({ created_at: hours(-7 * 24 - 1), whatsapp_clicked_at: hours(-7 * 24) });
    expect(leadView(old, null, null, T0)).toMatchObject({ canReport: false });
    expect(leadView(old, null, null, T0).reportHint).toMatch(/7-day window .* closed/);
    expect(leadView(lead({ created_at: hours(-7 * 24 + 1) }), null, null, T0).canReport).toBe(true);
  });
  it("a free preview can be rated but never reported", () => {
    const v = leadView(lead({ is_trial: true }), null, null, T0);
    expect(v.canRate).toBe(true);
    expect(v.canReport).toBe(false);
    expect(v.reportHint).toMatch(/Free previews/);
  });
  it("a refunded unlock cannot be reported again", () => {
    expect(leadView(lead({ refunded_at: hours(-1) }), null, null, T0).canReport).toBe(false);
  });
  it("one rating per unlock", () => {
    expect(leadView(lead(), "responsive", null, T0)).toMatchObject({ canRate: false, rating: "responsive" });
  });
  it("one report per unlock: once filed, the button is gone and no hint is shown", () => {
    const v = leadView(lead(), null, { unlock_id: "u1", status: "awaiting_talent", talent_deadline: hours(10) }, T0);
    expect(v).toMatchObject({ canReport: false, reportHint: null });
    expect(v.report?.status).toBe("awaiting_talent");
  });
});

describe("reportStatusLine", () => {
  it.each([
    ["awaiting_talent", /refunded automatically/],
    ["under_review", /reviewing it/],
    ["upheld", /refunded\./],
    ["rejected", /no refund/],
  ] as const)("%s", (status, re) => expect(reportStatusLine({ unlock_id: "u", status, talent_deadline: hours(5) }).text).toMatch(re));
});
