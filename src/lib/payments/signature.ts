import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay signs two different things, with two different secrets. Mixing them up is a classic bug.
 *
 *   WEBHOOK     x-razorpay-signature = HMAC_SHA256(raw request body, WEBHOOK secret)      -> server-to-server
 *   CHECKOUT    razorpay_signature   = HMAC_SHA256(order_id + "|" + payment_id, KEY secret) -> returned to the browser
 *
 * Both comparisons must be constant-time (timingSafeEqual), and the webhook one must use the RAW body bytes,
 * not a re-serialised JSON.parse() result (whitespace/ordering changes would break the HMAC).
 */
export function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual throws on different lengths, and a length mismatch is itself a rejection.
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function verifyWebhookSignature(rawBody: string, signature: string | null | undefined, webhookSecret: string): boolean {
  if (!signature || !webhookSecret) return false;
  return safeEqualHex(hmacHex(webhookSecret, rawBody), signature.trim());
}

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string | null | undefined, keySecret: string): boolean {
  if (!signature || !keySecret || !orderId || !paymentId) return false;
  return safeEqualHex(hmacHex(keySecret, `${orderId}|${paymentId}`), signature.trim());
}

/** Used by the dev-only mock checkout and by tests to produce a valid webhook signature. */
export function signWebhook(rawBody: string, webhookSecret: string): string {
  return hmacHex(webhookSecret, rawBody);
}
