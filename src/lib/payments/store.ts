import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentRow, PaymentStore } from "./settle";

/**
 * The real PaymentStore, backed by the database through a SERVICE-ROLE client that the caller passes in.
 * It lives apart from `src/lib/supabase/admin.ts` (which is `server-only`) so tests can run this exact code.
 * It never creates a client itself, so importing it cannot leak a key anywhere.
 */
export function databasePaymentStore(admin: SupabaseClient): PaymentStore {
  return {
    async findByOrderId(orderId) {
      const { data, error } = await admin
        .from("payments")
        .select("id, recruiter_id, amount_paise, status, credits_granted")
        .eq("razorpay_order_id", orderId)
        .maybeSingle();
      if (error) throw new Error(`payment lookup failed: ${error.message}`);
      return (data as PaymentRow | null) ?? null;
    },
    async fulfill(orderId, paymentId) {
      const { data, error } = await admin.rpc("fulfill_payment", { p_order_id: orderId, p_payment_id: paymentId });
      if (error) throw new Error(`fulfill_payment failed: ${error.message}`);
      return data as { status: "captured" | "already_captured"; credits?: number };
    },
  };
}
