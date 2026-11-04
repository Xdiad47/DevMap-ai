import { describe, expect, it } from "vitest";
import { hmacHex, signWebhook, verifyCheckoutSignature, verifyWebhookSignature } from "./signature";
import { parsePaidEvent, settleFromCheckout, settleFromWebhook, type PaymentRow, type PaymentStore } from "./settle";

const WEBHOOK_SECRET = "whsec_test_secret";
const KEY_SECRET = "key_secret_test";

describe("webhook signature", () => {
  const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 24900, currency: "INR" } } } });
  it("accepts the correct HMAC of the RAW body", () => {
    expect(verifyWebhookSignature(body, signWebhook(body, WEBHOOK_SECRET), WEBHOOK_SECRET)).toBe(true);
  });
  it("matches an independently computed HMAC-SHA256 (not just our own helper)", () => {
    // value computed with: printf '%s' 'hello' | openssl dgst -sha256 -hmac 'secret'
    expect(hmacHex("secret", "hello")).toBe("88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b");
  });
  it("rejects a tampered body, wrong secret, missing or malformed signature", () => {
    const sig = signWebhook(body, WEBHOOK_SECRET);
    expect(verifyWebhookSignature(body.replace("24900", "100"), sig, WEBHOOK_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, sig, "other_secret")).toBe(false);
    expect(verifyWebhookSignature(body, null, WEBHOOK_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "", WEBHOOK_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "abc", WEBHOOK_SECRET)).toBe(false); // wrong length must not throw
    expect(verifyWebhookSignature(body, sig, "")).toBe(false); // an unset secret must never validate anything
  });
  it("a re-serialised body does not verify (whitespace matters: hence the raw body)", () => {
    const sig = signWebhook(body, WEBHOOK_SECRET);
    expect(verifyWebhookSignature(JSON.stringify(JSON.parse(body), null, 2), sig, WEBHOOK_SECRET)).toBe(false);
  });
});

describe("checkout signature (order_id|payment_id, signed with the KEY secret)", () => {
  const sig = hmacHex(KEY_SECRET, "order_1|pay_1");
  it("accepts the right pair and rejects any swap", () => {
    expect(verifyCheckoutSignature("order_1", "pay_1", sig, KEY_SECRET)).toBe(true);
    expect(verifyCheckoutSignature("order_2", "pay_1", sig, KEY_SECRET)).toBe(false);
    expect(verifyCheckoutSignature("order_1", "pay_2", sig, KEY_SECRET)).toBe(false);
    expect(verifyCheckoutSignature("order_1", "pay_1", sig, WEBHOOK_SECRET)).toBe(false); // the two secrets are not interchangeable
    expect(verifyCheckoutSignature("", "pay_1", sig, KEY_SECRET)).toBe(false);
  });
});

describe("parsePaidEvent", () => {
  const evt = (event: string, entity: Record<string, unknown> | null) => ({ event, payload: { payment: entity ? { entity } : undefined } });
  const good = { id: "pay_1", order_id: "order_1", amount: 9900, currency: "INR" };
  it("understands payment.captured and order.paid", () => {
    expect(parsePaidEvent(evt("payment.captured", good))).toEqual({ orderId: "order_1", paymentId: "pay_1", amountPaise: 9900, currency: "INR" });
    expect(parsePaidEvent(evt("order.paid", good))).not.toBeNull();
  });
  it("ignores other events and malformed payloads", () => {
    expect(parsePaidEvent(evt("payment.failed", good))).toBeNull();
    expect(parsePaidEvent(evt("payment.captured", null))).toBeNull();
    expect(parsePaidEvent(evt("payment.captured", { ...good, amount: "9900" }))).toBeNull();
    expect(parsePaidEvent(null)).toBeNull();
    expect(parsePaidEvent("x")).toBeNull();
  });
});

function fakeStore(rows: PaymentRow[]) {
  const fulfilled: string[] = [];
  const store: PaymentStore = {
    async findByOrderId(orderId) {
      return rows.find((r) => (r as PaymentRow & { order: string }).order === orderId) ?? null;
    },
    async fulfill(orderId) {
      const first = !fulfilled.includes(orderId);
      fulfilled.push(orderId);
      return { status: first ? "captured" : "already_captured", credits: 3 };
    },
  };
  return { store, fulfilled };
}
const row = (over: Partial<PaymentRow & { order: string }> = {}) =>
  ({ id: "p1", recruiter_id: "rec_1", amount_paise: 24900, status: "created", credits_granted: 3, order: "order_1", ...over }) as PaymentRow;

describe("settleFromWebhook", () => {
  const evt = { orderId: "order_1", paymentId: "pay_1", amountPaise: 24900, currency: "INR" };
  it("fulfils a matching payment, and a replay is reported as already captured", async () => {
    const { store, fulfilled } = fakeStore([row()]);
    expect(await settleFromWebhook(store, evt)).toEqual({ ok: true, status: "captured", credits: 3 });
    expect(await settleFromWebhook(store, evt)).toMatchObject({ ok: true, status: "already_captured" });
    expect(fulfilled).toHaveLength(2); // the DB function is what makes this idempotent; we just always delegate
  });
  it("refuses an amount that differs from the order we created (underpayment / tampering)", async () => {
    const { store, fulfilled } = fakeStore([row()]);
    expect(await settleFromWebhook(store, { ...evt, amountPaise: 100 })).toEqual({ ok: false, reason: "amount_mismatch" });
    expect(fulfilled).toHaveLength(0);
  });
  it("refuses other currencies, unknown orders and refunded payments", async () => {
    const { store, fulfilled } = fakeStore([row(), row({ order: "order_r", status: "refunded" })]);
    expect(await settleFromWebhook(store, { ...evt, currency: "USD" })).toEqual({ ok: false, reason: "currency_mismatch" });
    expect(await settleFromWebhook(store, { ...evt, orderId: "nope" })).toEqual({ ok: false, reason: "unknown_order" });
    expect(await settleFromWebhook(store, { ...evt, orderId: "order_r" })).toEqual({ ok: false, reason: "refunded" });
    expect(fulfilled).toHaveLength(0);
  });
});

describe("settleFromCheckout", () => {
  it("only credits the recruiter who owns the order", async () => {
    const { store, fulfilled } = fakeStore([row()]);
    expect(await settleFromCheckout(store, "order_1", "pay_1", "someone_else")).toEqual({ ok: false, reason: "not_yours" });
    expect(fulfilled).toHaveLength(0);
    expect(await settleFromCheckout(store, "order_1", "pay_1", "rec_1")).toMatchObject({ ok: true });
  });
  it("unknown order -> not fulfilled", async () => {
    const { store } = fakeStore([]);
    expect(await settleFromCheckout(store, "order_x", "pay_1", "rec_1")).toEqual({ ok: false, reason: "unknown_order" });
  });
});

import { resolvePaymentConfig } from "./config-core";

describe("resolvePaymentConfig", () => {
  const live = { RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "ks", RAZORPAY_WEBHOOK_SECRET: "ws" };
  it("mock mode is IMPOSSIBLE in production, whatever else is set", () => {
    expect(() => resolvePaymentConfig({ RAZORPAY_MODE: "mock", NODE_ENV: "production" })).toThrow(/not allowed in production/);
    expect(() => resolvePaymentConfig({ RAZORPAY_MODE: "mock", NODE_ENV: "production", ...live })).toThrow(/not allowed in production/);
  });
  it("mock mode works in development with built-in dev secrets", () => {
    expect(resolvePaymentConfig({ RAZORPAY_MODE: "mock", NODE_ENV: "development" })).toMatchObject({ mode: "mock", keyId: "rzp_test_mock" });
  });
  it("live mode needs all three values", () => {
    expect(() => resolvePaymentConfig({})).toThrow(/Missing/);
    expect(() => resolvePaymentConfig({ ...live, RAZORPAY_WEBHOOK_SECRET: "" })).toThrow(/Missing/);
    expect(resolvePaymentConfig({ ...live, NODE_ENV: "production" })).toMatchObject({ mode: "live", keyId: "rzp_live_x" });
  });
  it("live mode rejects reusing one secret for both purposes", () => {
    expect(() => resolvePaymentConfig({ ...live, RAZORPAY_WEBHOOK_SECRET: "ks" })).toThrow(/different values/);
  });
  it("any other RAZORPAY_MODE value is treated as live (never silently mock)", () => {
    expect(() => resolvePaymentConfig({ RAZORPAY_MODE: "MOCK" })).toThrow(/Missing/);
  });
});
