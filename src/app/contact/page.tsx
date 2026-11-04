import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { getCompany } from "@/lib/company";

export const metadata: Metadata = { title: "Contact", description: "How to reach DevMap.in." };

export default function Contact() {
  const c = getCompany();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="rounded-3xl bg-gradient-to-r from-sky-500 to-indigo-600 p-7 text-white shadow-lg sm:p-9">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Contact us</h1>
        <p className="mt-2 text-white/90">A real person reads every message. We reply within {c.replyTime}.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="space-y-1 rounded-3xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Support &amp; refunds</p>
          <a href={`mailto:${c.supportEmail}`} className="block break-all text-lg font-semibold text-slate-900 hover:underline">{c.supportEmail}</a>
          <p className="text-sm text-slate-600">{c.hours}</p>
          <p className="pt-2 text-sm text-slate-600">For payment problems include your Razorpay payment ID. For a strike or report review, write from the email address on your profile.</p>
        </Card>
        <Card className="space-y-1 rounded-3xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-pink-700">Privacy &amp; grievances</p>
          <p className="text-sm text-slate-700">{c.grievanceName ? <>Grievance Officer: <strong>{c.grievanceName}</strong></> : "Grievance Officer"}</p>
          <a href={`mailto:${c.grievanceEmail}`} className="block break-all text-lg font-semibold text-slate-900 hover:underline">{c.grievanceEmail}</a>
          <p className="pt-2 text-sm text-slate-600">To see, correct or delete your data, or to withdraw consent. See the <a className="text-indigo-700 underline" href="/privacy">Privacy Policy</a>.</p>
        </Card>
      </div>

      {(c.legalName || c.address || c.gstin) && (
        <Card className="space-y-2 rounded-3xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Who we are</p>
          {c.legalName && <p className="font-semibold text-slate-900">{c.legalName}</p>}
          {c.address && <p className="whitespace-pre-line text-sm text-slate-700">{c.address}</p>}
          {c.gstin && <p className="text-sm text-slate-700">GSTIN: {c.gstin}</p>}
        </Card>
      )}

      <p className="text-center text-sm text-slate-500">
        Read our <a className="text-indigo-700 underline" href="/terms">Terms</a>, <a className="text-indigo-700 underline" href="/refunds">Refunds &amp; Cancellation</a> and <a className="text-indigo-700 underline" href="/pricing">Pricing</a>.
      </p>
    </div>
  );
}
