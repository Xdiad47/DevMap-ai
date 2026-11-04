import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { decideBan, resolveGhost, reviewAttestation } from "@/app/admin/actions";
import { DecisionForm } from "@/components/admin/DecisionForm";
import { PortfolioForm } from "@/components/admin/PortfolioForm";
import { EvidenceList, Field, SafeLink, TalentBlock, when } from "@/components/admin/bits";
import { Alert, Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin/access";
import { parseEvidence } from "@/lib/admin/evidence";
import { attestationCase, getItem, ghostCase, groupOfType, talentFile, recentAudit, type QueueItem } from "@/lib/admin/queue";
import { RUBRIC } from "@/lib/admin/rubric";

export const metadata: Metadata = { title: "Review item · Admin" };

export default async function ReviewItem({ params }: PageProps<"/admin/review-queue/[id]">) {
  const { id } = await params;
  const { db } = await requireAdmin(`/admin/review-queue/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const item = await getItem(db, id);
  if (!item) notFound();

  const open = item.status === "pending" || item.status === "in_review";
  const talent = item.talent_id ? await talentFile(db, item.talent_id) : null;
  const audit = await recentAudit(db, item.related_id ?? item.talent_id ?? item.id);

  return (
    <div className="space-y-5">
      <Link href={`/admin/review-queue?group=${groupOfType(item.type)}`} className="text-sm font-medium text-emerald-700 hover:underline">← Back to the queue</Link>
      <h1 className="text-2xl font-semibold">{TITLES[item.type] ?? item.type}</h1>
      {!open && <Alert tone="info">Resolved as <strong>{item.status}</strong> on {when(item.resolved_at)}{item.reviewer_notes ? `: “${item.reviewer_notes}”` : ""}</Alert>}

      {talent && <Card><h2 className="mb-3 text-lg font-semibold">The person</h2><TalentBlock t={talent} />{talent && <p className="mt-3 text-xs"><Link className="text-emerald-700 underline" href={`/admin/talent/${talent.id}`}>Full file →</Link></p>}</Card>}

      {item.type === "ghost_dispute" && item.related_id && <GhostPanel item={item} open={open} />}
      {item.type === "attestation_spotcheck" && item.related_id && <AttestationPanel item={item} open={open} />}
      {item.type === "ban_review" && talent && open && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Decision</h2>
          <p className="mb-3 text-sm text-slate-600">A permanent ban blocklists the phone number and GitHub account (as hashes) so they can&apos;t re-register. Take your time: it can be reversed with “Restore”, but the person will have lost access meanwhile.</p>
          <DecisionForm action={decideBan} hidden={{ talentId: talent.id, queueId: item.id }} choices={[
            { value: "ban", label: "Ban permanently", tone: "danger" },
            { value: "dismiss", label: "No ban: suspension runs its course", tone: "neutral" },
            { value: "restore", label: "Restore now (lift suspension, overturn strikes)", tone: "primary" },
          ]} />
        </Card>
      )}
      {(item.type === "designer_portfolio" || item.type === "marketer_portfolio") && talent && open && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Score the portfolio</h2>
          <p className="mb-3 text-sm text-slate-600">Open every link above. Scores add up to the 0–40 work-depth points; the tier adds verification points. Approval lists the person on the map.</p>
          <PortfolioForm talentId={talent.id} queueId={item.id} labels={RUBRIC[item.type === "designer_portfolio" ? "designer" : "marketer"]} />
        </Card>
      )}

      {audit.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Earlier actions on this</h2>
          <ul className="space-y-1 text-sm text-slate-700">{audit.map((a, i) => <li key={i}>{when(a.created_at)} · {a.action}{a.notes ? ` · “${a.notes}”` : ""}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}

const TITLES: Record<string, string> = {
  designer_portfolio: "Designer portfolio review",
  marketer_portfolio: "Marketer portfolio review",
  ghost_dispute: "Ghost-report dispute",
  ban_review: "Strike 3: ban review",
  attestation_spotcheck: "Client attestation spot-check",
};

async function GhostPanel({ item, open }: { item: QueueItem; open: boolean }) {
  const { db } = await requireAdmin();
  const c = await ghostCase(db, item.related_id!);
  if (!c) return <Alert tone="warn">The report behind this item no longer exists.</Alert>;
  const evidence = parseEvidence(c.evidence_urls.length ? c.evidence_urls : item.evidence_urls);
  return (
    <>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">The recruiter says</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label="Recruiter">{c.recruiter_company ?? "(no company name)"} · {c.recruiter_reports_this_month} report(s) in the last 31 days</Field>
          <Field label="Reported">{when(c.created_at)}</Field>
          <Field label="Unlocked">{when(c.unlock?.created_at ?? null)} · {c.unlock?.credits_deducted ?? "?"} credit(s) · {c.unlock?.tier_at_unlock}</Field>
          <Field label="Opened WhatsApp">{when(c.unlock?.whatsapp_clicked_at ?? null)}</Field>
          <Field label="Talent tapped “Got it”">{c.unlock?.talent_acknowledged_at ? when(c.unlock.talent_acknowledged_at) : "never"}</Field>
          <div className="sm:col-span-2"><Field label="Recruiter's note">{c.recruiter_note ? `“${c.recruiter_note}”` : "none"}</Field></div>
        </dl>
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">The talent replies</h2>
        <p className="mb-3 text-sm text-slate-800">{c.talent_dispute_note ? `“${c.talent_dispute_note}”` : "No written note."}</p>
        <EvidenceList items={evidence} />
        <p className="mt-3 text-xs text-slate-500">You can&apos;t see the WhatsApp chat itself. Judge whether the evidence plausibly shows a reply <em>to this recruiter</em> within the window (check the dates in the screenshot against the times above).</p>
      </Card>
      {open && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Decision</h2>
          <p className="mb-3 text-sm text-slate-600">
            <strong>Uphold</strong>: refund the recruiter {c.unlock?.credits_deducted ?? "their"} credit(s) and add a strike to the talent. <strong>Reject</strong>: no refund, no strike.
          </p>
          <DecisionForm action={resolveGhost} hidden={{ reportId: c.id, queueId: item.id }} choices={[
            { value: "uphold", label: "Uphold: refund + strike", tone: "danger" },
            { value: "reject", label: "Reject: talent did reply", tone: "primary" },
          ]} />
        </Card>
      )}
    </>
  );
}

async function AttestationPanel({ item, open }: { item: QueueItem; open: boolean }) {
  const { db } = await requireAdmin();
  const c = await attestationCase(db, item.related_id!);
  if (!c) return <Alert tone="warn">The attestation behind this item no longer exists.</Alert>;
  return (
    <>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">What the client confirmed</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label="Project">{c.project?.generic_title} {c.project && <>· <SafeLink url={c.project.live_url} /></>}</Field>
          <Field label="Asked via">{c.channel === "whatsapp" ? "WhatsApp (the talent carried the link: always checked)" : "E-mail (sent by us to the client)"}</Field>
          <Field label="Client contact">{c.contact_masked}</Field>
          <Field label="Confirmed">{when(c.responded_at)} · status {c.status}</Field>
          <Field label="This contact's confirmations in 30 days">{c.confirmations_for_contact_30d} (limit 2)</Field>
        </dl>
        <p className="mt-3 text-xs text-slate-500">Check: does the site plausibly belong to a business the talent worked for? Does the contact look like the site&apos;s owner rather than a friend or the talent&apos;s own alternate address?</p>
      </Card>
      {open && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Decision</h2>
          <p className="mb-3 text-sm text-slate-600"><strong>Reject</strong> voids the confirmation: the project loses its attested verification (direct proof, if any, is untouched).</p>
          <DecisionForm action={reviewAttestation} hidden={{ attestationId: c.id, queueId: item.id }} choices={[
            { value: "approve", label: "Looks genuine", tone: "primary" },
            { value: "reject", label: "Reject: void the confirmation", tone: "danger" },
          ]} />
        </Card>
      )}
    </>
  );
}
