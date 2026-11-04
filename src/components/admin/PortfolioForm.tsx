"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/card";
import type { FormState } from "@/app/admin/actions";
import { reviewPortfolio } from "@/app/admin/actions";

/** Four 0-10 rubric scores add up to the 0-40 work depth the database takes. Approve picks the tier; Reject records 0. */
export function PortfolioForm({ talentId, queueId, labels }: { talentId: string; queueId: string; labels: readonly string[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(reviewPortfolio, undefined);
  const [scores, setScores] = useState([5, 5, 5, 5]);
  const total = scores.reduce((a, b) => a + b, 0);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="talentId" value={talentId} />
      <input type="hidden" name="queueId" value={queueId} />
      <div className="grid gap-3 sm:grid-cols-2">
        {labels.map((label, i) => (
          <label key={label} className="block text-sm font-medium text-slate-800">
            {label} <span className="text-slate-500">(0–10)</span>
            <input name={`s${i + 1}`} type="number" min={0} max={10} step={1} required value={scores[i]}
              onChange={(e) => setScores((s) => s.map((v, j) => (j === i ? Number(e.target.value) : v)))}
              className="mt-1 block w-full rounded-lg border-0 p-2 text-sm ring-1 ring-slate-300" />
          </label>
        ))}
      </div>
      <p className="text-sm text-slate-700">Work depth: <strong>{total}</strong> / 40 <span className="text-slate-500">(recorded as 0 if you reject)</span></p>
      <label className="block text-sm font-medium text-slate-800">
        Note (shown to the talent if rejected)
        <textarea name="notes" maxLength={500} rows={2} className="mt-1 block w-full rounded-lg border-0 p-2 text-sm ring-1 ring-slate-300" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="tier" value="reviewed" disabled={pending} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          Approve: reviewed (+10 verification)
        </button>
        <button type="submit" name="tier" value="verified" disabled={pending} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50">
          Approve: verified (+20, ownership confirmed)
        </button>
        <button type="submit" name="tier" value="unverified" disabled={pending} className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
          Reject
        </button>
      </div>
      {state?.error && <Alert tone="error">{state.error}</Alert>}
    </form>
  );
}
