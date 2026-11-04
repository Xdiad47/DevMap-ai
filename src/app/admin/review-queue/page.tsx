import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { when } from "@/components/admin/bits";
import { requireAdmin } from "@/lib/admin/access";
import { GROUPS, GROUP_KEYS, listItems, queueCounts, type GroupKey } from "@/lib/admin/queue";

export const metadata: Metadata = { title: "Review queues · Admin" };

export default async function ReviewQueue({ searchParams }: PageProps<"/admin/review-queue">) {
  const { db } = await requireAdmin();
  const sp = await searchParams;
  const group: GroupKey = GROUP_KEYS.find((g) => g === sp.group) ?? "portfolio";
  const state = sp.state === "resolved" ? "resolved" : "open";

  const [counts, { items, talents }] = await Promise.all([queueCounts(db), listItems(db, group, state)]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Review queues</h1>
        <p className="mt-1 text-sm text-slate-600">{GROUPS[group].blurb}</p>
      </div>
      {sp.done && <Alert tone="success">Saved. The decision is in the audit log.</Alert>}

      <div className="flex flex-wrap gap-2" role="tablist">
        {GROUP_KEYS.map((g) => (
          <Link key={g} href={`/admin/review-queue?group=${g}`} role="tab" aria-selected={g === group}
            className={cn("rounded-full px-4 py-1.5 text-sm font-medium ring-1", g === group ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50")}>
            {GROUPS[g].label}
            <span className={cn("ml-2 rounded-full px-2 py-0.5 text-xs", counts[g] > 0 ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-500")}>{counts[g]}</span>
          </Link>
        ))}
      </div>

      <div className="flex gap-3 text-sm">
        <Link href={`/admin/review-queue?group=${group}`} className={state === "open" ? "font-semibold text-slate-900" : "text-slate-500 hover:text-slate-800"}>Open</Link>
        <Link href={`/admin/review-queue?group=${group}&state=resolved`} className={state === "resolved" ? "font-semibold text-slate-900" : "text-slate-500 hover:text-slate-800"}>Resolved</Link>
      </div>

      {items.length === 0 ? (
        <Card><p className="text-sm text-slate-600">{state === "open" ? "Nothing waiting. 🎉" : "Nothing resolved yet."}</p></Card>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => {
            const t = it.talent_id ? talents.get(it.talent_id) : undefined;
            return (
              <li key={it.id}>
                <Link href={`/admin/review-queue/${it.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-400">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold text-slate-900">{t ? `${t.masked_name} · ${t.role} · ${t.city}` : "Unknown profile"}</p>
                    <p className="text-xs text-slate-500">
                      {it.status === "pending" || it.status === "in_review" ? `waiting since ${when(it.created_at)}` : `${it.status} ${when(it.resolved_at)}`}
                    </p>
                  </div>
                  {it.reviewer_notes && <p className="mt-1 text-sm text-slate-600">“{it.reviewer_notes}”</p>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
