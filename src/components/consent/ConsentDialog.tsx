"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { CONSENT_COPY, type ConsentType } from "@/lib/constants";

/**
 * DPDP consent dialog. Each consent is its own unticked checkbox (no pre-ticking, no bundling),
 * and the confirm button stays disabled until every required box is ticked.
 *
 * It does not talk to the database itself: the parent calls `recordMissingConsents()` from the
 * browser in `onConfirm`, then saves the profile. Consent first, data second.
 */
export function ConsentDialog({
  open,
  types,
  title,
  confirmLabel,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  types: ConsentType[];
  title: string;
  confirmLabel: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});

  // <dialog> is opened/closed imperatively; showModal() gives us focus trapping + Esc for free.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const allTicked = types.every((t) => ticked[t]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault(); // we control closing via `open`
        if (!busy) onCancel();
      }}
      aria-labelledby="consent-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl p-0 shadow-xl backdrop:bg-slate-900/50"
    >
      <div className="space-y-5 p-6">
        <div>
          <h2 id="consent-title" className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            India&apos;s data protection law (DPDP Act) requires your clear permission. Tick each box to agree. You can
            withdraw any of these later from your dashboard.
          </p>
        </div>

        <ul className="space-y-3">
          {types.map((type) => (
            <li key={type}>
              <label className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={!!ticked[type]}
                  onChange={(e) => setTicked((t) => ({ ...t, [type]: e.target.checked }))}
                  className="mt-1 size-4 accent-emerald-600"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-900">{CONSENT_COPY[type].title}</span>
                  <span className="block text-xs text-slate-600">{CONSENT_COPY[type].body}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <p className="text-xs text-slate-500">
          Read the{" "}
          <Link href="/terms" target="_blank" className="underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" className="underline">
            Privacy Policy
          </Link>
          .
        </p>

        {error && <Alert tone="error">{error}</Alert>}

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Back
          </Button>
          <Button onClick={onConfirm} disabled={!allTicked} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
