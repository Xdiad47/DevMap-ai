import "server-only";
import { resolvePaymentConfig, type PaymentConfig } from "./config-core";

export type { PaymentConfig };

/**
 * `RAZORPAY_MODE=mock` lets you test the whole purchase flow locally with no Razorpay account: orders are
 * fake, and a dev-only button posts a correctly SIGNED webhook to our own endpoint, so the real webhook code
 * path (signature -> amount check -> fulfill_payment) still runs. See config-core.ts for the rules.
 */
export function getPaymentConfig(): PaymentConfig {
  return resolvePaymentConfig(process.env as Record<string, string | undefined>);
}
