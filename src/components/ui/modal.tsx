"use client";

import { useEffect, useRef } from "react";
import { cn } from "./cn";

/** Native <dialog>: showModal() gives focus trapping, Esc to close and a backdrop with no extra library. */
export function Modal({
  open,
  onClose,
  title,
  children,
  className,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      className={cn("m-auto w-[min(34rem,calc(100vw-2rem))] rounded-2xl p-0 shadow-xl backdrop:bg-slate-900/50", className)}
    >
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id="modal-title" className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {dismissible && (
              <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">
                ✕
              </button>
            )}
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
