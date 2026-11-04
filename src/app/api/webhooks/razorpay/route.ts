import { type NextRequest } from "next/server";
import { json } from "@/lib/http";
import { getPaymentConfig } from "@/lib/payments/config";
import { parsePaidEvent, settleFromWebhook } from "@/lib/payments/settle";
import { verifyWebhookSignature } from "@/lib/payments/signature";
import { databasePaymentStore } from "@/lib/payments/store";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Razorpay -> us. Order of operations matters:
 *   1. read the RAW body  2. verify the signature  3. only THEN parse  4. check the amount  5. fulfil (idempotent)
 *
 * Status codes are chosen for Razorpay's retry behaviour (it retries any non-2xx for ~24h):
 *   400  bad signature            -> not Razorpay; retrying would change nothing
 *   200  event we don't handle, or a payment we refuse on purpose (mismatch) -> stop retrying; we log loudly instead
 *   500  our database failed      -> please retry
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const cfg = getPaymentConfig();

  if (!verifyWebhookSignature(raw, request.headers.get("x-razorpay-signature"), cfg.webhookSecret)) {
    return json({ error: "bad_signature" }, 400);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const evt = parsePaidEvent(body);
  if (!evt) return json({ ignored: "event_not_handled" });

  try {
    const outcome = await settleFromWebhook(databasePaymentStore(createAdminClient()), evt);
    if (!outcome.ok) {
      // A PAID event we refused to credit needs a human. Make it impossible to miss in the logs.
      console.error("[razorpay-webhook] REFUSED paid event", { reason: outcome.reason, orderId: evt.orderId, paymentId: evt.paymentId, amountPaise: evt.amountPaise });
      return json({ ignored: outcome.reason });
    }
    return json({ status: outcome.status });
  } catch (e) {
    console.error("[razorpay-webhook] database error", e);
    return json({ error: "temporary_failure" }, 500);
  }
}
