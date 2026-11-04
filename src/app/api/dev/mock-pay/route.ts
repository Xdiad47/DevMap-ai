import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, json } from "@/lib/http";
import { getPaymentConfig } from "@/lib/payments/config";
import { signWebhook } from "@/lib/payments/signature";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * DEV ONLY ("Simulate UPI payment" in mock mode). It pretends to be Razorpay: it builds a `payment.captured`
 * event for a real order, SIGNS it with the webhook secret, and posts it to our own webhook endpoint, so the
 * production code path runs end to end. Refuses to do anything unless RAZORPAY_MODE=mock (never in production).
 */
export async function POST(request: NextRequest) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  let cfg;
  try {
    cfg = getPaymentConfig();
  } catch {
    return json({ error: "not_available" }, 404);
  }
  if (cfg.mode !== "mock") return json({ error: "not_available" }, 404);

  const parsed = z.object({ orderId: z.string().min(1).max(64) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "bad_request" }, 400);

  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return json({ error: "not_authenticated" }, 401);

  // Only the order's owner may "pay" it, and the amount comes from our own record, like a real payment would.
  const admin = createAdminClient();
  const { data: recruiter } = await sb.from("recruiters").select("id").eq("user_id", auth.user.id).maybeSingle();
  const { data: payment } = await admin.from("payments").select("recruiter_id, amount_paise").eq("razorpay_order_id", parsed.data.orderId).maybeSingle();
  if (!recruiter || !payment || payment.recruiter_id !== recruiter.id) return json({ error: "unknown_order" }, 404);

  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_mock_${randomUUID().replaceAll("-", "").slice(0, 14)}`, order_id: parsed.data.orderId, amount: payment.amount_paise, currency: "INR", status: "captured" } } },
  });
  const res = await fetch(`${request.nextUrl.origin}/api/webhooks/razorpay`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": signWebhook(body, cfg.webhookSecret) },
    body,
  });
  return json({ webhookStatus: res.status, webhook: await res.json().catch(() => null) });
}
