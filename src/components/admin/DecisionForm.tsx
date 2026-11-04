"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import type { FormState } from "@/app/admin/actions";

type Choice = { value: string; label: string; tone?: "danger" | "primary" | "neutral" };

const TONES = {
  danger: "bg-red-600 text-white hover:bg-red-700",
  primary: "bg-emerald-600 text-white hover:bg-emerald-700",
  neutral: "bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50",
};

/**
 * One reason box + one button per possible decision. The decision travels as the clicked button's `value`; the server
 * action validates everything again, so nothing here is trusted.
 */
export function DecisionForm({
  action, hidden, choices, notesLabel = "Reason (kept in the audit log)", children,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  choices: Choice[];
  notesLabel?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-3">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <label className="block text-sm font-medium text-slate-800">
        {notesLabel}
        <textarea name="notes" required minLength={5} maxLength={500} rows={3} className="mt-1 block w-full rounded-lg border-0 p-2 text-sm ring-1 ring-slate-300" />
      </label>
      <div className="flex flex-wrap gap-2">
        {choices.map((c) => (
          <button key={c.value} type="submit" name="decision" value={c.value} disabled={pending}
            className={cn("rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50", TONES[c.tone ?? "neutral"])}>
            {c.label}
          </button>
        ))}
      </div>
      {state?.error && <Alert tone="error">{state.error}</Alert>}
    </form>
  );
}
