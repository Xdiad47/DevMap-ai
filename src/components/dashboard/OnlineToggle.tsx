"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { setOnline, type OnlineState } from "@/app/dashboard/talent/online-actions";

/** One button. "Online" means "I'm free to take work right now"; it switches itself off after a few hours. */
export function OnlineToggle({ online, canGoOnline, expiryHours }: { online: boolean; canGoOnline: boolean; expiryHours: number }) {
  const [state, action, pending] = useActionState<OnlineState, FormData>(setOnline, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="online" value={online ? "0" : "1"} />
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
          <span className={online ? "size-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_3px_rgba(16,185,129,.5)]" : "size-2.5 rounded-full bg-slate-300"} />
          {online ? "You are Online" : "You are Offline"}
        </span>
        <Button type="submit" disabled={pending || (!online && !canGoOnline)} variant={online ? "ghost" : "primary"}>
          {pending ? "Saving…" : online ? "Go Offline" : "Go Online"}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Online talent are shown first and get a green dot. It switches off by itself after {expiryHours} hours, so recruiters can trust it.
      </p>
      {state?.error && <p className="text-xs font-medium text-red-600">{state.error}</p>}
    </form>
  );
}
