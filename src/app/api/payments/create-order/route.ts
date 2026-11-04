import { type NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, json } from "@/lib/http";
import { getPaymentConfig } from "@/lib/payments/config";
import { createRazorpayOrder } from "@/lib/payments/razorpay";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({ bundleId: z.string().min(1).max(40), idempotencyKey: z.uuid() });

/**
 * Step 1 of buying credits. The browser says WHICH bundle; the server decides the price (from `credit_bundles`),
 * creates the Razorpay order for exactly that amount, and records it. Nothing the browser sends can change the amount.
 * The idempotency key makes a double-click or a retry return the SAME order instead of creating a second one.
 */
export async function POST(request: NextRequest) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  const { bundleId, idempotencyKey } = parsed.data;

  // Who is asking? (user session, subject to RLS: a user can only see their own recruiter row)
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return json({ error: "not_authenticated" }, 401);
  const { data: recruiter } = await sb.from("recruiters").select("id").eq("user_id", auth.user.id).is("deleted_at", null).maybeSingle();
  if (!recruiter) return json({ error: "recruiter_profile_required" }, 403);

  const cfg = getPaymentConfig();
  const admin = createAdminClient();

  // Retry of the same click -> same order.
  const existing = await admin
    .from("payments")
    .select("razorpay_order_id, amount_paise, credits_granted, bundle_id")
    .eq("idempotency_key", idempotencyKey)
    .eq("recruiter_id", recruiter.id)
    .maybeSingle();
  if (existing.data) {
    return json({ orderId: existing.data.razorpay_order_id, amountPaise: existing.data.amount_paise, credits: existing.data.credits_granted, keyId: cfg.keyId, mode: cfg.mode });
  }

  const bundle = await admin.from("credit_bundles").select("id, label, credits, price_paise").eq("id", bundleId).eq("is_active", true).maybeSingle();
  if (!bundle.data) return json({ error: "bundle_unavailable" }, 404);

  const order = await createRazorpayOrder(cfg, {
    amountPaise: bundle.data.price_paise,
    receipt: idempotencyKey,
    notes: { recruiter_id: recruiter.id, bundle_id: bundle.data.id },
  });

  const { error } = await admin.rpc("create_payment_order", {
    p_recruiter: recruiter.id,
    p_bundle: bundle.data.id,
    p_idempotency_key: idempotencyKey,
    p_razorpay_order_id: order.id,
  });
  if (error) return json({ error: "order_record_failed" }, 500);

  return json({ orderId: order.id, amountPaise: bundle.data.price_paise, credits: bundle.data.credits, label: bundle.data.label, keyId: cfg.keyId, mode: cfg.mode });
}
