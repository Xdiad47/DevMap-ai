import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { decideTalent } from "@/app/admin/actions";
import { DecisionForm } from "@/components/admin/DecisionForm";
import { TalentBlock, when } from "@/components/admin/bits";
import { Alert, Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin/access";
import { recentAudit, talentFile } from "@/lib/admin/queue";

export const metadata: Metadata = { title: "Talent file · Admin" };

/** Where a strike-appeal e-mail lands: the talent id is in its subject. */
export default async function TalentPage({ params, searchParams }: PageProps<"/admin/talent/[id]">) {
  const { id } = await params;
  const { db } = await requireAdmin(`/admin/talent/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await talentFile(db, id);
  if (!t) notFound();
  const audit = await recentAudit(db, id);
  const sp = await searchParams;
  return (
    <div className="space-y-5">
      <Link href="/admin/review-queue" className="text-sm font-medium text-emerald-700 hover:underline">← Review queues</Link>
      <h1 className="text-2xl font-semibold">{t.masked_name}</h1>
      {sp.done && <Alert tone="success">Saved. The decision is in the audit log.</Alert>}
      <Card><TalentBlock t={t} /></Card>
      <Card>
        <h2 className="mb-1 text-lg font-semibold">{t.is_banned ? "Restore this person" : "Act on this account"}</h2>
        <p className="mb-3 text-sm text-slate-600">Restoring lifts a ban or suspension and marks active strikes as overturned (e.g. after an appeal).</p>
        <DecisionForm action={decideTalent} hidden={{ talentId: t.id }} choices={t.is_banned
          ? [{ value: "restore", label: "Restore", tone: "primary" }]
          : [{ value: "restore", label: "Lift suspension / overturn strikes", tone: "primary" }, { value: "ban", label: "Ban permanently", tone: "danger" }]} />
      </Card>
      {audit.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Audit trail</h2>
          <ul className="space-y-1 text-sm text-slate-700">{audit.map((a, i) => <li key={i}>{when(a.created_at)} · {a.action}{a.notes ? ` · “${a.notes}”` : ""}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
