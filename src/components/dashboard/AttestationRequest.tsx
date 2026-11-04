"use client";

import { useActionState, useState } from "react";
import { askClient, type AskState } from "@/app/dashboard/talent/attestation-actions";
import { Alert } from "@/components/ui/card";

export type AttestationRow = { id: string; project_id: string; channel: string; contact_masked: string; status: string; expires_at: string; created_at: string };

const STATUS: Record<string, string> = { pending: "waiting for them", confirmed: "confirmed ✓", declined: "declined", expired: "expired" };

/** "Built this for a client? Ask them to confirm." Shown under each unverified project. */
export function AttestationRequest({ projectId, requests }: { projectId: string; requests: AttestationRow[] }) {
  const [state, action, pending] = useActionState<AskState, FormData>(askClient, undefined);
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");

  return (
    <div className="mt-2 space-y-2">
      {requests.length > 0 && (
        <ul className="space-y-0.5 text-xs text-slate-600">
          {requests.map((r) => (
            <li key={r.id}>Asked {r.contact_masked} ({r.channel === "email" ? "e-mail" : "WhatsApp"}): {STATUS[r.status] ?? r.status}</li>
          ))}
        </ul>
      )}
      {/* <details> is native: the form is in the page even before JavaScript loads */}
      <details open={!!state} className="group">
        <summary className="cursor-pointer text-xs font-medium text-emerald-700 underline">Built it for a client? Ask them to confirm</summary>
        <form action={action} className="mt-2 space-y-2 rounded-lg bg-white p-3 ring-1 ring-slate-200">
          <input type="hidden" name="projectId" value={projectId} />
          <fieldset className="flex gap-4 text-xs">
            <legend className="sr-only">How should we reach your client?</legend>
            <label className="flex items-center gap-1"><input type="radio" name="channel" value="email" checked={channel === "email"} onChange={() => setChannel("email")} /> E-mail (we send it)</label>
            <label className="flex items-center gap-1"><input type="radio" name="channel" value="whatsapp" checked={channel === "whatsapp"} onChange={() => setChannel("whatsapp")} /> WhatsApp (you send it)</label>
          </fieldset>
          <input
            name="contact" required maxLength={254} inputMode={channel === "email" ? "email" : "tel"} autoComplete="off"
            placeholder={channel === "email" ? "client@theircompany.in" : "98765 43210"}
            className="block w-full rounded-lg border-0 p-2 text-sm ring-1 ring-slate-300"
          />
          <p className="text-xs text-slate-500">
            Their one-tap confirmation earns half the points of verifying the site yourself, and works for sites you don&apos;t control. We never store their address. {channel === "whatsapp" && "WhatsApp confirmations are always double-checked by our team."}
          </p>
          <button type="submit" disabled={pending} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {pending ? "Sending…" : channel === "email" ? "Send the request" : "Prepare the WhatsApp message"}
          </button>
          {state?.error && <Alert tone="error">{state.error}</Alert>}
          {state?.ok && (
            <Alert tone="success">
              {state.ok.channel === "email" ? (
                <>Request sent to {state.ok.sentTo}. It lasts 7 days.</>
              ) : (
                <>
                  Ready for {state.ok.sentTo}.{" "}
                  <a href={state.ok.waLink} target="_blank" rel="noopener noreferrer" className="font-medium underline">Open WhatsApp and send it</a>. The link works once.
                </>
              )}
            </Alert>
          )}
        </form>
      </details>
    </div>
  );
}
