"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { friendlyMessage } from "@/lib/errors";
import type { LeadView } from "@/lib/leads/status";
import { openWhatsapp, reportGhosting, submitLeadFeedback } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/client";

/**
 * The three things a recruiter can do after an unlock. Every button calls a database function that re-checks the
 * rules (`LeadView` only decides what to SHOW), so a stale page can never do something the rules forbid.
 */
export function LeadActions({ talentId, firstName, view, refunded }: { talentId: string; firstName: string; view: LeadView; refunded: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "wa" | "responsive" | "not_fit" | "report">(null);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");

  async function act(kind: NonNullable<typeof busy>, fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      router.refresh(); // the server page re-reads the unlock, rating and report
    } catch (e) {
      setError(friendlyMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (refunded) return <p className="text-sm text-slate-500">Refunded: the contact is closed.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          loading={busy === "wa"}
          onClick={() =>
            act("wa", async () => {
              const link = await openWhatsapp(createClient(), talentId); // records the click
              const text = encodeURIComponent(`Hi ${firstName}, I found you on DevMap.in and would like to discuss a project.`);
              window.open(`${link}?text=${text}`, "_blank", "noopener,noreferrer");
            })
          }
        >
          Open WhatsApp
        </Button>

        {view.rating ? (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
            You rated: {view.rating === "responsive" ? "👍 Responsive & professional" : "👎 Not a good fit"}
          </span>
        ) : view.canRate ? (
          <>
            <Button variant="ghost" loading={busy === "responsive"} onClick={() => act("responsive", () => submitLeadFeedback(createClient(), talentId, "responsive"))}>
              👍 Responsive
            </Button>
            <Button variant="ghost" loading={busy === "not_fit"} onClick={() => act("not_fit", () => submitLeadFeedback(createClient(), talentId, "not_fit"))}>
              👎 Not a fit
            </Button>
          </>
        ) : null}

        {view.canReport && !reporting && (
          <Button variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => setReporting(true)}>
            🚩 Report: no reply
          </Button>
        )}
      </div>

      {view.reportHint && <p className="text-xs text-slate-500">{view.reportHint}</p>}

      {reporting && (
        <div className="space-y-3 rounded-xl bg-red-50 p-4 ring-1 ring-red-200">
          <p className="text-sm font-medium text-red-900">Report that {firstName} didn&apos;t reply?</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-red-900">
            <li>They get 12 hours to show they replied. If they stay silent, your credit is refunded automatically.</li>
            <li>If they dispute it, our team reviews it. Reports that turn out to be wrong don&apos;t refund.</li>
            <li>You can send at most 2 reports a month, so use them for genuine silence.</li>
          </ul>
          <label className="block text-xs text-red-900">
            Anything we should know? (optional)
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              className="mt-1 block w-full rounded-lg border-0 bg-white p-2 text-sm text-slate-900 ring-1 ring-red-200"
            />
          </label>
          <div className="flex gap-2">
            <Button className="bg-red-600 hover:bg-red-700" loading={busy === "report"} onClick={() => act("report", async () => { await reportGhosting(createClient(), talentId, note); setReporting(false); })}>
              Send report
            </Button>
            <Button variant="ghost" onClick={() => setReporting(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
