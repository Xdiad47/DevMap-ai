/**
 * CONTRACT TEST (Sprint 2): the app's real search, quote, unlock and payment-settlement code against the real
 * migrations + supabase/seed.sql, through supabase-js -> PostgREST -> Postgres, with signed JWTs.
 * Run with:  npm run test:contract
 *
 * Assertions look only at the 15 SEED profiles (deterministic ids), because other test files add their own people.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RECRUITER_CONSENTS } from "@/lib/constants";
import { attachCardExtras } from "@/lib/discovery/cards";
import { DEFAULT_FILTERS, type Filters } from "@/lib/discovery/filters";
import { searchTalent } from "@/lib/discovery/search";
import { friendlyMessage } from "@/lib/errors";
import { databasePaymentStore } from "@/lib/payments/store";
import { settleFromCheckout, settleFromWebhook } from "@/lib/payments/settle";
import { hmacHex, verifyCheckoutSignature } from "@/lib/payments/signature";
import { createRecruiterProfile, recordMissingConsents } from "@/lib/rpc";
import { safeHttpUrl } from "@/lib/url";
import { buildCreateRecruiterArgs } from "@/lib/validation/recruiter";
import { CONTAINER, clientFor, confirmPhone, isSeed, newUser, seedId, seedNumbers, sql, startProxy } from "@/lib/testing/contract-harness";

let proxy: { url: string; close: () => void };
let rec: SupabaseClient; // a signed-in recruiter
let recId = "";
let admin: SupabaseClient; // service role: stands in for our payment routes

const F = (over: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...over });
const ids = async (f: Partial<Filters>) => seedNumbers((await searchTalent(rec, F(f))).rows);

beforeAll(async () => {
  if (!CONTAINER) return;
  proxy = await startProxy();
  const uid = newUser();
  rec = clientFor(proxy.url, { userId: uid });
  admin = clientFor(proxy.url, { service: true });
  confirmPhone(uid, "+919700000001");
  await recordMissingConsents(rec, RECRUITER_CONSENTS);
  recId = await createRecruiterProfile(rec, buildCreateRecruiterArgs({ companyName: "Discovery Test Co", gstin: "" }));
});
afterAll(() => proxy?.close());

describe.skipIf(!CONTAINER)("discovery against the seeded database", () => {
  it("returns all 15 seed profiles, best score first", async () => {
    const { rows } = await searchTalent(rec, F());
    const seeds = rows.filter((r) => isSeed(r.id));
    expect(seeds).toHaveLength(15);
    const scores = rows.map((r) => Number(r.composite_rank_score));
    expect(scores).toEqual([...scores].sort((a, b) => b - a)); // ranked
    expect(seeds[0].masked_name).toBe("Rahul S."); // the 100-proof, 99%-uptime developer leads
  });

  it("role filter", async () => {
    expect(await ids({ role: "designer" })).toEqual([7, 8, 9, 10]);
    expect(await ids({ role: "marketer" })).toEqual([11, 12, 13, 14]);
  });

  describe("Intent Gateway", () => {
    it("'I need an Android / iOS app' -> mobile developers", async () => expect(await ids({ intent: "app" })).toEqual([1, 4, 6]));
    it("'I need a website' -> web developers AND web designers, no marketers", async () => expect(await ids({ intent: "website" })).toEqual([2, 5, 8, 9]));
    it("'I need a logo / app design' -> designers with design skills", async () => expect(await ids({ intent: "design" })).toEqual([7, 8, 10]));
    it("'I need ads / more customers' -> performance + SEO marketers", async () => expect(await ids({ intent: "ads" })).toEqual([11, 13, 14]));
    it("'I need content in my language' -> vernacular copywriters; pick a language to narrow", async () => {
      expect(await ids({ intent: "regional-content" })).toEqual([12, 14]);
      expect(await ids({ intent: "regional-content", language: "Marathi" })).toEqual([12]);
      expect(await ids({ intent: "regional-content", language: "Kannada" })).toEqual([14]);
    });
  });

  it("language matches native OR secondary language", async () => {
    expect(await ids({ language: "Telugu" })).toEqual([5, 6, 14]); // #5 native Telugu; #6 and #14 list Telugu as a second language
    expect(await ids({ language: "Bengali" })).toEqual([4, 9, 13]);
  });

  it("city, Online-now and budget filters", async () => {
    expect(await ids({ city: "Kolkata", online: true })).toEqual([4, 9, 13]);
    expect(await ids({ state: "Maharashtra" })).toEqual([3, 8, 12]);
    expect(await ids({ online: true, role: "marketer" })).toEqual([11, 13, 14]);
    expect(await ids({ maxRate: 500 })).toEqual([3, 4, 5, 9, 11, 12, 13]);
  });

  describe("relaxation, end to end", () => {
    it("nobody in Mumbai is a developer -> shows builders within ~250 km (Pune), and says so", async () => {
      const r = await searchTalent(rec, F({ role: "developer", city: "Mumbai", state: "Maharashtra" }));
      expect(r.notice).toMatch(/Nobody in Mumbai yet.*250 km/);
      expect(seedNumbers(r.rows)).toEqual([3]);
    });
    it("nearby results are closest first", async () => {
      // Nobody lives in Nashik. Mumbai is ~140 km away, Pune ~165 km: Mumbai's designer must come before Pune's people.
      const r = await searchTalent(rec, F({ city: "Nashik", state: "Maharashtra" }));
      const inOrder = r.rows.filter((x) => isSeed(x.id)).map((x) => Number(x.id.slice(-2))); // seedNumbers() sorts, which would hide the order
      expect(r.notice).toMatch(/Nobody in Nashik yet/);
      expect(inOrder[0]).toBe(8);
      expect([...inOrder].sort((a, b) => a - b)).toEqual([3, 8, 12]);
    });
    it("a city with nobody anywhere near falls back to all of India, and says builders work remotely", async () => {
      const r = await searchTalent(rec, F({ city: "Guwahati", state: "Assam" }));
      expect(r.notice).toMatch(/Nobody near Guwahati yet.*across India.*remote/);
      expect(seedNumbers(r.rows)).toHaveLength(15);
    });
    it("a state with nobody falls back to all of India", async () => {
      const r = await searchTalent(rec, F({ state: "Assam" }));
      expect(r.notice).toMatch(/Nobody in Assam yet.*across India/);
      expect(seedNumbers(r.rows)).toHaveLength(15);
    });
    it("NEVER drops the language: an unmatched language returns nothing, with no misleading notice", async () => {
      const r = await searchTalent(rec, F({ language: "Nepali" }));
      expect(seedNumbers(r.rows)).toEqual([]);
      expect(r.total).toBe(0);
      expect(r.notice).toBeNull();
    });
    it("one exact match + no city filter: keeps the single honest result, no notice", async () => {
      const r = await searchTalent(rec, F({ intent: "regional-content", online: true }));
      expect(seedNumbers(r.rows)).toEqual([14]); // #12 is Offline; do not swap in a wider set
      expect(r.notice).toBeNull();
    });
  });

  it("role counts for the chips ignore the role filter itself", async () => {
    const r = await searchTalent(rec, F({ role: "designer" }));
    expect(r.roleCounts.developer).toBeGreaterThanOrEqual(7);
    expect(r.roleCounts.marketer).toBeGreaterThanOrEqual(4);
  });
});

describe.skipIf(!CONTAINER)("masked cards: quotes and abstracted titles", () => {
  it("elite = 2 credits; standard = 1; high score but idle 10 days = NOT elite", async () => {
    const cards = await attachCardExtras(rec, (await searchTalent(rec, F())).rows.filter((r) => isSeed(r.id)));
    const q = (n: number) => cards.find((c) => c.id === seedId(n))!.quote;
    expect(q(1)).toEqual({ tier: "top_tier", credits: 2 });
    expect(q(10)).toEqual({ tier: "top_tier", credits: 2 });
    expect(q(5)).toEqual({ tier: "standard", credits: 1 });
    expect(q(15)).toEqual({ tier: "standard", credits: 1 });
  });
  it("shows generic titles of verified projects only, never a URL", async () => {
    const cards = await attachCardExtras(rec, (await searchTalent(rec, F())).rows.filter((r) => isSeed(r.id)));
    expect(cards.find((c) => c.id === seedId(1))!.projects).toHaveLength(2);
    expect(cards.find((c) => c.id === seedId(5))!.projects).toHaveLength(0);
    for (const c of cards) for (const p of c.projects) expect(p.generic_title).not.toMatch(/https?:|\.invalid/);
  });
  it("a card contains no contact field at all", async () => {
    const [row] = (await searchTalent(rec, F())).rows;
    const forbidden = ["phone_e164", "whatsapp_number", "email", "telegram_handle", "telegram_chat_id", "full_name", "live_url", "repo_url", "portfolio_links", "github_username"];
    for (const field of forbidden) expect(Object.keys(row)).not.toContain(field);
  });
  it("recruiters read zero rows of the contact vault and the projects table", async () => {
    expect((await rec.from("talent_private").select("full_name,whatsapp_number")).data).toEqual([]);
    expect((await rec.from("projects").select("live_url")).data).toEqual([]);
  });
});

describe.skipIf(!CONTAINER)("unlock + Razorpay settlement against the real database", () => {
  const unlock = (n: number) => rec.rpc("unlock_talent_contact", { p_talent_id: seedId(n) });
  const balance = () => Number(sql(`select credits_balance from recruiters where id='${recId}'`));

  it("1. the free preview unlocks a STANDARD profile and returns exactly four fields", async () => {
    const { data, error } = await unlock(5);
    expect(error).toBeNull();
    expect(Object.keys(data).sort()).toEqual(["full_name", "portfolio_links", "telegram_handle", "whatsapp_number"]);
    expect(data.full_name).toBe("Nandini Reddy");
    expect(data.whatsapp_number).toBe("+919000000005");
    expect(sql(`select trial_unlocks_remaining from recruiters where id='${recId}'`)).toBe("0");
  });

  it("2. re-opening an unlocked contact is free and idempotent", async () => {
    const before = balance();
    expect((await unlock(5)).error).toBeNull();
    expect(balance()).toBe(before);
    expect(sql(`select count(*) from lead_unlocks where recruiter_id='${recId}' and talent_id='${seedId(5)}'`)).toBe("1");
  });

  it("3. an elite profile with no credits is refused, with friendly copy", async () => {
    const { error } = await unlock(1);
    expect(error?.message).toContain("insufficient_credits");
    expect(friendlyMessage(error)).toMatch(/enough credits/);
  });

  it("4. a profile at its daily cap cannot be unlocked", async () => {
    const { error } = await unlock(15);
    expect(error?.message).toContain("talent_daily_limit_reached");
    expect(friendlyMessage(error)).toMatch(/limit/i);
  });

  describe("buying credits (the order -> webhook / checkout paths)", () => {
    const store = () => databasePaymentStore(admin);
    let orderId = "";

    it("5. the server creates the order from the bundle id; the amount comes from the database, not the caller", async () => {
      const { data, error } = await admin.rpc("create_payment_order", {
        p_recruiter: recId, p_bundle: "credits_3", p_idempotency_key: "ct-idem-1", p_razorpay_order_id: "order_ct_1",
      });
      expect(error).toBeNull();
      orderId = data.razorpay_order_id;
      expect(data.amount_paise).toBe(24900); // Rs 249, inclusive of tax
      expect(data.credits_granted).toBe(3);
      // same idempotency key -> the SAME order, no duplicate
      const again = await admin.rpc("create_payment_order", { p_recruiter: recId, p_bundle: "credits_3", p_idempotency_key: "ct-idem-1", p_razorpay_order_id: "order_ct_other" });
      expect(again.data.razorpay_order_id).toBe("order_ct_1");
    });

    it("6. a recruiter cannot create orders or grant themselves credits", async () => {
      const a = await rec.rpc("create_payment_order", { p_recruiter: recId, p_bundle: "credits_10", p_idempotency_key: "x", p_razorpay_order_id: "order_evil" });
      expect(a.error?.message).toMatch(/permission denied|forbidden/);
      const b = await rec.rpc("fulfill_payment", { p_order_id: orderId, p_payment_id: "pay_evil" });
      expect(b.error?.message).toMatch(/permission denied|forbidden/);
      expect(balance()).toBe(0);
    });

    it("7. a webhook for the WRONG amount is refused and credits nothing", async () => {
      const r = await settleFromWebhook(store(), { orderId, paymentId: "pay_1", amountPaise: 9900, currency: "INR" });
      expect(r).toEqual({ ok: false, reason: "amount_mismatch" });
      expect(balance()).toBe(0);
    });

    it("8. a checkout callback for somebody else's order is refused", async () => {
      expect(await settleFromCheckout(store(), orderId, "pay_1", "00000000-0000-0000-0000-00000000dead")).toEqual({ ok: false, reason: "not_yours" });
      expect(balance()).toBe(0);
    });

    it("9. the correct webhook credits 3, and replays (webhook x3 + browser callback) credit nothing more", async () => {
      const evt = { orderId, paymentId: "pay_ct_1", amountPaise: 24900, currency: "INR" };
      expect(await settleFromWebhook(store(), evt)).toMatchObject({ ok: true, status: "captured" });
      expect(await settleFromWebhook(store(), evt)).toMatchObject({ ok: true, status: "already_captured" });
      expect(await settleFromWebhook(store(), evt)).toMatchObject({ ok: true, status: "already_captured" });
      expect(await settleFromCheckout(store(), orderId, "pay_ct_1", recId)).toMatchObject({ ok: true, status: "already_captured" });
      expect(balance()).toBe(3);
      expect(sql(`select count(*) from credits_ledger where recruiter_id='${recId}' and reason='purchase'`)).toBe("1");
    });

    it("10. the checkout signature scheme matches Razorpay's (HMAC over order|payment with the key secret)", () => {
      expect(verifyCheckoutSignature("order_ct_1", "pay_ct_1", hmacHex("k", "order_ct_1|pay_ct_1"), "k")).toBe(true);
    });
  });

  it("11. with credits, the elite profile unlocks for 2 and reveals links; WhatsApp click is recorded", async () => {
    const { data, error } = await unlock(1);
    expect(error).toBeNull();
    expect(data.full_name).toBe("Rahul Sharma");
    expect(balance()).toBe(1); // 3 - 2
    const links = (data.portfolio_links as string[]).map(safeHttpUrl);
    expect(links.every(Boolean)).toBe(true);
    expect(links).toHaveLength(2); // the two verified projects
    const wa = await rec.rpc("open_whatsapp", { p_talent_id: seedId(1) });
    expect(wa.data).toBe("https://wa.me/919000000001");
    expect(sql(`select has_clicked_whatsapp from lead_unlocks where recruiter_id='${recId}' and talent_id='${seedId(1)}'`)).toBe("t");
  });

  it("12. the quote the card showed is what the ledger charged", () => {
    expect(sql(`select credits_deducted||','||tier_at_unlock from lead_unlocks where recruiter_id='${recId}' and talent_id='${seedId(1)}'`)).toBe("2,top_tier");
    expect(sql(`select credits_deducted||','||is_trial from lead_unlocks where recruiter_id='${recId}' and talent_id='${seedId(5)}'`)).toBe("0,true");
  });
});
