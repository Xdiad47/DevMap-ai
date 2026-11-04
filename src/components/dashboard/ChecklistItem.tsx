import { cn } from "@/components/ui/cn";

export function ChecklistItem({
  done,
  title,
  detail,
  children,
}: {
  done: boolean;
  title: string;
  detail?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-4 py-4">
      <span
        aria-label={done ? "Done" : "To do"}
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-bold",
          done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-500",
        )}
      >
        {done ? "✓" : "·"}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className={cn("text-sm font-semibold", done ? "text-slate-500" : "text-slate-900")}>{title}</p>
        {detail && <div className="text-sm text-slate-600">{detail}</div>}
        {!done && children}
      </div>
    </li>
  );
}
