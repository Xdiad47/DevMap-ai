"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { formatPaise, perCreditPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";
import { fetchWallet, waitForBalanceAbove, type Bundle, type Wallet } from "./wallet";

type CreatedOrder = { orderId: string; amountPaise: number; credits: number; keyId: string; mode: "live" | "mock"; label?: string };

interface RazorpayCheckout {
  open(): void;
  on(event: string, cb: (r: unknown) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the payment window. Check your connection."));
    document.body.appendChild(s);
  });
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
  return data;
}

/**
 * Buy credits. Mobile browsers get Razorpay's UPI-intent sheet (GPay / PhonePe / Paytm) and desktop gets a UPI QR:
 * Razorpay Checkout picks that itself; we only restrict it to UPI. The price is chosen by the SERVER from the
 * bundle id, never by this component.
 */
export function PurchasePanel({
  bundles,
  wallet,
  needed,
  email,
  onPaid,
}: {
  bundles: Bundle[];
  wallet: Wallet;
  /** credits still missing for the unlock the user wanted (to highlight the smallest bundle that covers it) */
  needed: number;
  email: string;
  onPaid: (w: Wallet) => void;
}) {
  const bestFit = bundles.find((b) => b.credits >= needed) ?? bundles[bundles.length - 1];
  const [selected, setSelected] = useState<string>(bestFit?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mock, setMock] = useState<CreatedOrder | null>(null);
  const [waiting, setWaiting] = useState(false);
  const idempotency = useRef<{ bundle: string; key: string } | null>(null);

  const sb = createClient();

  async function afterPayment() {
    setWaiting(true);
    const w = await waitForBalanceAbove(sb, wallet.balance);
    setWaiting(false);
    if (w) onPaid(w);
    else setError("Payment received, but your credits haven't appeared yet. Refresh in a minute. If they're still missing, contact support with your payment id.");
  }

  async function pay() {
    setError(null);
    setBusy(true);
    try {
      // One idempotency key per (bundle, attempt): a double-click can never create two orders.
      if (idempotency.current?.bundle !== selected) idempotency.current = { bundle: selected, key: crypto.randomUUID() };
      const order = await post<CreatedOrder>("/api/payments/create-order", { bundleId: selected, idempotencyKey: idempotency.current.key });

      if (order.mode === "mock") {
        setMock(order);
        return;
      }
      await loadRazorpay();
      const rz = new window.Razorpay!({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: "INR",
        name: "DevMap.in",
        description: `${order.credits} credits`,
        prefill: { email },
        theme: { color: "#059669" },
        // UPI only (PRD §4). Needs checking in Razorpay TEST mode before launch; see README.
        config: {
          display: {
            blocks: { upi: { name: "Pay with UPI", instruments: [{ method: "upi" }] } },
            sequence: ["block.upi"],
            preferences: { show_default_blocks: false },
          },
        },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await post("/api/payments/verify", r); // fast path; the webhook is the safety net
          } catch {
            /* the webhook may still credit us; the balance poll below decides */
          }
          idempotency.current = null;
          await afterPayment();
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rz.on("payment.failed", () => setError("The payment didn't go through. You haven't been charged. Please try again."));
      rz.open();
    } catch (e) {
      setError(e instanceof Error ? friendly(e.message) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    if (!mock) return;
    setBusy(true);
    setError(null);
    try {
      await post("/api/dev/mock-pay", { orderId: mock.orderId });
      setMock(null);
      idempotency.current = null;
      await afterPayment();
    } catch (e) {
      setError(e instanceof Error ? friendly(e.message) : "Mock payment failed");
    } finally {
      setBusy(false);
    }
  }

  if (waiting) {
    return (
      <div className="space-y-3 py-6 text-center">
        <span className="mx-auto block size-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
        <p className="text-sm text-slate-700">Confirming your payment…</p>
      </div>
    );
  }

  if (mock) {
    return (
      <div className="space-y-4">
        <Alert tone="warn">
          <p className="font-semibold">TEST MODE: no real money.</p>
          <p className="mt-1">This stands in for Razorpay Checkout. It posts a signed webhook to this app, the same path a real payment takes.</p>
        </Alert>
        <div className="rounded-lg border border-slate-200 p-4 text-sm">
          <p className="font-medium">Pay {formatPaise(mock.amountPaise)} for {mock.credits} credits</p>
          <p className="mt-1 text-xs text-slate-500">Order {mock.orderId}</p>
        </div>
        <div className="flex gap-3">
          <Button onClick={simulate} loading={busy}>Simulate UPI payment</Button>
          <Button variant="secondary" onClick={() => setMock(null)} disabled={busy}>Cancel</Button>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="sr-only">Choose a credit pack</legend>
        {bundles.map((b) => (
          <label
            key={b.id}
            className={cn(
              "flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3.5",
              selected === b.id ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600" : "border-slate-200 hover:bg-slate-50",
            )}
          >
            <span className="flex items-center gap-3">
              <input type="radio" name="bundle" checked={selected === b.id} onChange={() => setSelected(b.id)} className="accent-emerald-600" />
              <span>
                <span className="block text-sm font-semibold text-slate-900">
                  {b.label}
                  {b.id === bestFit?.id && needed > 0 && <span className="ml-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">Covers this unlock</span>}
                </span>
                <span className="block text-xs text-slate-500">
                  {formatPaise(perCreditPaise(b.price_paise, b.credits))} per credit · 1 credit = a standard profile, 2 = elite
                </span>
              </span>
            </span>
            <span className="text-base font-semibold text-slate-900">{formatPaise(b.price_paise)}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-slate-500">Prices include all taxes. Pay by UPI (GPay, PhonePe, Paytm or any UPI app).</p>
      <Button onClick={pay} loading={busy} disabled={!selected} className="w-full">
        Pay with UPI
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

function friendly(code: string): string {
  const map: Record<string, string> = {
    not_authenticated: "Your session expired. Please sign in again.",
    recruiter_profile_required: "Set up your recruiter account first.",
    bundle_unavailable: "That pack isn't available right now.",
    bad_origin: "Request blocked. Reload the page and try again.",
  };
  return map[code] ?? "Something went wrong. Please try again.";
}

export { fetchWallet };
