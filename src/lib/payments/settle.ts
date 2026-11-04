/**
 * Turning "Razorpay says this order was paid" into credits. Kept free of Next.js / Supabase imports so it can
 * be unit-tested with a fake store. The ONLY thing that grants credits is `fulfill_payment()` in the database,
 * which is idempotent (webhooks retry, and the browser callback races the webhook), so calling this twice is safe.
 */
export type PaymentRow = {
  id: string;
  recruiter_id: string;
  amount_paise: number;
  status: string;
  credits_granted: number;
};

export interface PaymentStore {
  findByOrderId(orderId: string): Promise<PaymentRow | null>;
  fulfill(orderId: string, paymentId: string): Promise<{ status: "captured" | "already_captured"; credits?: number }>;
}

export type PaidEvent = { orderId: string; paymentId: string; amountPaise: number; currency: string };

export type SettleOutcome =
  | { ok: true; status: "captured" | "already_captured"; credits?: number }
  | { ok: false; reason: "unknown_order" | "amount_mismatch" | "currency_mismatch" | "payment_not_captured" | "refunded" };

/** Webhook path: we trust the amount Razorpay reports ONLY after checking it equals what we created the order for. */
export async function settleFromWebhook(store: PaymentStore, evt: PaidEvent): Promise<SettleOutcome> {
  const row = await store.findByOrderId(evt.orderId);
  if (!row) return { ok: false, reason: "unknown_order" };
  if (evt.currency !== "INR") return { ok: false, reason: "currency_mismatch" };
  if (evt.amountPaise !== Number(row.amount_paise)) return { ok: false, reason: "amount_mismatch" };
  return fulfil(store, row, evt.orderId, evt.paymentId);
}

/** Browser-callback path: the HMAC over (order|payment) already proved Razorpay issued this payment for this order. */
export async function settleFromCheckout(store: PaymentStore, orderId: string, paymentId: string, recruiterId: string): Promise<SettleOutcome | { ok: false; reason: "not_yours" }> {
  const row = await store.findByOrderId(orderId);
  if (!row) return { ok: false, reason: "unknown_order" };
  if (row.recruiter_id !== recruiterId) return { ok: false, reason: "not_yours" }; // never credit someone else's order
  return fulfil(store, row, orderId, paymentId);
}

async function fulfil(store: PaymentStore, row: PaymentRow, orderId: string, paymentId: string): Promise<SettleOutcome> {
  if (row.status === "refunded") return { ok: false, reason: "refunded" };
  const res = await store.fulfill(orderId, paymentId);
  return { ok: true, status: res.status, credits: res.credits };
}

/** Extracts what we need from a Razorpay webhook body. Only "payment is done" events matter; everything else -> null. */
export function parsePaidEvent(body: unknown): PaidEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { event?: string; payload?: { payment?: { entity?: Record<string, unknown> } } };
  if (b.event !== "payment.captured" && b.event !== "order.paid") return null;
  const p = b.payload?.payment?.entity;
  if (!p) return null;
  const { id, order_id, amount, currency } = p as { id?: unknown; order_id?: unknown; amount?: unknown; currency?: unknown };
  if (typeof id !== "string" || typeof order_id !== "string" || typeof amount !== "number" || typeof currency !== "string") return null;
  return { orderId: order_id, paymentId: id, amountPaise: amount, currency };
}
