import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cn("rounded-2xl border border-slate-200 bg-white p-6 shadow-sm", className)} />;
}

export function Alert({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "error" | "success" | "warn";
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "bg-sky-50 text-sky-900 ring-sky-200",
    error: "bg-red-50 text-red-900 ring-red-200",
    success: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    warn: "bg-amber-50 text-amber-900 ring-amber-200",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg px-4 py-3 text-sm ring-1", tones[tone], className)}>
      {children}
    </div>
  );
}
