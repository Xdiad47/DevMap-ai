import "server-only";
import { randomUUID } from "node:crypto";
import type { PaymentConfig } from "./config";

export type RazorpayOrder = { id: string };

/** Creates the order on Razorpay (live) or invents one (mock). The amount is ALWAYS decided by our server. */
export async function createRazorpayOrder(
  cfg: PaymentConfig,
  input: { amountPaise: number; receipt: string; notes: Record<string, string> },
): Promise<RazorpayOrder> {
  if (cfg.mode === "mock") return { id: `order_mock_${randomUUID().replaceAll("-", "").slice(0, 14)}` };

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Basic " + Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64"),
    },
    body: JSON.stringify({ amount: input.amountPaise, currency: "INR", receipt: input.receipt.slice(0, 40), notes: input.notes }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Razorpay order creation failed (${res.status})`);
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("Razorpay returned no order id");
  return { id: json.id };
}
