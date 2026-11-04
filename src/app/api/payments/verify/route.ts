import { type NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, json } from "@/lib/http";
import { getPaymentConfig } from "@/lib/payments/config";
import { settleFromCheckout } from "@/lib/payments/settle";
import { verifyCheckoutSignature } from "@/lib/payments/signature";
import { databasePaymentStore } from "@/lib/payments/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  razorpay_order_id: z.string().min(1).max(64),
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_signature: z.string().min(1).max(200),
});

/**
 * Step 3a: the browser's "payment succeeded" callback. The webhook is the authoritative path, but it can be
 * seconds late (and can't reach localhost at all), so the credits would appear to "not arrive". The callback carries a
 * signature only Razorpay (and we) can produce, so we can safely fulfil right away. Fulfilling is idempotent, so
 * whichever of the two arrives second is a harmless no-op.
 */
export async function POST(request: NextRequest) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = parsed.data;

  const cfg = getPaymentConfig();
  if (!verifyCheckoutSignature(orderId, paymentId, signature, cfg.keySecret)) return json({ error: "bad_signature" }, 400);

  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return json({ error: "not_authenticated" }, 401);
  const { data: recruiter } = await sb.from("recruiters").select("id").eq("user_id", auth.user.id).is("deleted_at", null).maybeSingle();
  if (!recruiter) return json({ error: "recruiter_profile_required" }, 403);

  const outcome = await settleFromCheckout(databasePaymentStore(createAdminClient()), orderId, paymentId, recruiter.id);
  if (!outcome.ok) return json({ error: outcome.reason }, outcome.reason === "not_yours" ? 403 : 404);
  return json({ status: outcome.status, credits: outcome.credits });
}
