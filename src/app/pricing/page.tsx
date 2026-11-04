import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { getCompany } from "@/lib/company";
import { formatPaise } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Pricing", description: "Free for talent. Recruiters pay per unlock, GST included." };

type Bundle = { id: string; label: string; credits: number; price_paise: number };
const TINTS = ["from-sky-500 to-indigo-500", "from-emerald-500 to-teal-500", "from-pink-500 to-amber-500"];

export default async function Pricing() {
  const c = getCompany();
  // Read-only public data (the packs are the same for everyone). A failure shows the page without prices rather than crashing.
  let bundles: Bundle[] = [];
  try {
    const { data } = await createAdminClient().from("credit_bundles").select("id, label, credits, price_paise").eq("is_active", true).order("sort_order");
    bundles = (data ?? []) as Bundle[];
  } catch {
    bundles = [];
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="rounded-3xl bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600 p-7 text-white shadow-lg sm:p-9">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Simple pricing</h1>
        <p className="mt-2 max-w-2xl text-white/90">Free for talent, always. Recruiters pay only when they unlock a contact. No subscription, no commission on your project.</p>
      </header>

      <section aria-label="Credit packs">
        <h2 className="mb-3 text-xl font-semibold">Credit packs (for recruiters)</h2>
        {bundles.length === 0 ? (
          <Card>Prices are temporarily unavailable. Please try again shortly or <Link className="text-indigo-700 underline" href="/contact">contact us</Link>.</Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {bundles.map((b, i) => (
              <div key={b.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className={`bg-gradient-to-r ${TINTS[i % TINTS.length]} px-5 py-4 text-white`}>
                  <p className="text-sm font-medium text-white/90">{b.label}</p>
                  <p className="text-3xl font-bold">{formatPaise(b.price_paise)}</p>
                </div>
                <div className="space-y-1 px-5 py-4 text-sm text-slate-700">
                  <p><strong className="text-lg text-slate-900">{b.credits}</strong> credit{b.credits === 1 ? "" : "s"}</p>
                  <p>{formatPaise(Math.round(b.price_paise / b.credits))} per credit</p>
                  <p className="text-slate-500">Inclusive of GST</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-sm text-slate-600">All prices are in Indian rupees and <strong>include all taxes (GST)</strong>{c.gstin ? <> (GSTIN {c.gstin})</> : null}. You pay with UPI through Razorpay.</p>
      </section>

      <section aria-label="What an unlock costs" className="grid gap-4 sm:grid-cols-3">
        <Card className="rounded-3xl"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Free preview</p><p className="mt-1 text-2xl font-bold">0 credits</p><p className="mt-1 text-sm text-slate-600">Your first unlock is free, on a standard-tier profile. One per verified mobile number.</p></Card>
        <Card className="rounded-3xl"><p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Standard profile</p><p className="mt-1 text-2xl font-bold">1 credit</p><p className="mt-1 text-sm text-slate-600">Most listed talent. The price is shown on their card before you confirm.</p></Card>
        <Card className="rounded-3xl"><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Top-tier profile</p><p className="mt-1 text-2xl font-bold">2 credits</p><p className="mt-1 text-sm text-slate-600">High score and recently active (the &ldquo;Elite&rdquo; tag).</p></Card>
      </section>

      <Card className="space-y-2 rounded-3xl text-sm leading-6 text-slate-700">
        <h2 className="text-lg font-semibold text-slate-900">Good to know</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Talent pay nothing</strong> to be listed, ranked or contacted.</li>
          <li>An unlock reveals the person&apos;s full name, WhatsApp number and verified project links, and you can view them again for free.</li>
          <li>If someone never replies you can report it and get your credits back: see <Link className="text-indigo-700 underline" href="/refunds">Refunds &amp; Cancellation</Link>.</li>
          <li>We take <strong>no commission</strong> on any work you agree directly with someone.</li>
        </ul>
      </Card>
    </div>
  );
}
