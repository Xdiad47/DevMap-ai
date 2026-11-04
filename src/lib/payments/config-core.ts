export type PaymentConfig = {
  mode: "live" | "mock";
  keyId: string; // public: sent to the browser to open Checkout
  keySecret: string; // SECRET: signs order creation + checkout signatures
  webhookSecret: string; // SECRET: signs webhooks (a different value from keySecret; set in the Razorpay dashboard)
};

type Env = Record<string, string | undefined>;

/**
 * Pure decision logic (no `server-only`, so it is unit-tested). The one rule that must never break:
 * mock payments cannot exist in production, no matter what an env var says.
 */
export function resolvePaymentConfig(env: Env): PaymentConfig {
  if (env.RAZORPAY_MODE === "mock") {
    if (env.NODE_ENV === "production") throw new Error("RAZORPAY_MODE=mock is not allowed in production.");
    return {
      mode: "mock",
      keyId: "rzp_test_mock",
      keySecret: env.RAZORPAY_KEY_SECRET || "mock_key_secret",
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || "mock_webhook_secret",
    };
  }
  const { RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: keySecret, RAZORPAY_WEBHOOK_SECRET: webhookSecret } = env;
  if (!keyId || !keySecret || !webhookSecret) {
    throw new Error("Missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET.");
  }
  if (keySecret === webhookSecret) {
    // They sign different things; reusing one value means a leaked webhook secret could forge checkout signatures.
    throw new Error("RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET must be different values.");
  }
  return { mode: "live", keyId, keySecret, webhookSecret };
}
