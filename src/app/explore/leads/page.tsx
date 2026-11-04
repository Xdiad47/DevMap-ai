import type { Metadata } from "next";
import Link from "next/link";
import { LeadActions } from "@/components/leads/LeadActions";
import { Alert, Card } from "@/components/ui/card";
import { enforceRecruiter } from "@/lib/auth/viewer";
import { formatWhen, leadView, reportStatusLine, type LeadReport, type LeadRow, type Rating } from "@/lib/leads/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My leads" };

const LEAD_COLUMNS = "id, talent_id, created_at, is_trial, credits_deducted, has_clicked_whatsapp, whatsapp_clicked_at, refunded_at";

export default async function LeadsPage() {
  await enforceRecruiter("/explore/leads");
  const sb = await createClient();

  // All three tables are readable only for this recruiter's own rows (RLS); ghost_reports exposes a column subset.
  const [leadsRes, ratingsRes, reportsRes] = await Promise.all([
    sb.from("lead_unlocks").select(LEAD_COLUMNS).order("created_at", { ascending: false }).limit(50),
    sb.from("lead_feedback").select("unlock_id, rating"),
    sb.from("ghost_reports").select("unlock_id, status, talent_deadline"),
  ]);
  for (const r of [leadsRes, ratingsRes, reportsRes]) if (r.error) throw new Error(`leads data failed: ${r.error.message}`);

  const leads = (leadsRes.data ?? []) as LeadRow[];
  const ratings = new Map((ratingsRes.data ?? []).map((r) => [r.unlock_id as string, r.rating as Rating]));
  const reports = new Map(((reportsRes.data ?? []) as LeadReport[]).map((r) => [r.unlock_id, r]));

  // Masked card for display. A profile that has since gone offline-for-good simply isn't returned (RLS).
  const ids = [...new Set(leads.map((l) => l.talent_id))];
  const cardsRes = ids.length ? await sb.from("talent_public").select("id, masked_name, city, role").in("id", ids) : { data: [], error: null };
  if (cardsRes.error) throw new Error(`leads cards failed: ${cardsRes.error.message}`);
  const cards = new Map((cardsRes.data ?? []).map((c) => [c.id as string, c as { id: string; masked_name: string; city: string; role: string }]));

  const now = new Date();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My leads</h1>
          <p className="mt-1 text-sm text-slate-600">Everyone you&apos;ve unlocked. Message them on WhatsApp, then tell us how it went.</p>
        </div>
        <Link href="/explore" className="text-sm font-medium text-emerald-700 hover:underline">← Back to explore</Link>
      </div>

      {leads.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">You haven&apos;t unlocked anyone yet. Your first unlock is free.</p>
        </Card>
      ) : (
        <ul className="space-y-4">
          {leads.map((lead) => {
            const card = cards.get(lead.talent_id);
            const view = leadView(lead, ratings.get(lead.id) ?? null, reports.get(lead.id) ?? null, now);
            const status = view.report ? reportStatusLine(view.report) : null;
            const refunded = lead.refunded_at !== null;
            return (
              <li key={lead.id}>
                <Card className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{card?.masked_name ?? "Profile no longer available"}</p>
                      <p className="text-xs text-slate-500">
                        {card ? `${card.role} · ${card.city} · ` : ""}Unlocked {formatWhen(lead.created_at)} IST ·{" "}
                        {lead.is_trial ? "free preview" : `${lead.credits_deducted} credit${lead.credits_deducted === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    {lead.has_clicked_whatsapp && lead.whatsapp_clicked_at && (
                      <p className="text-xs text-slate-500">WhatsApp opened {formatWhen(lead.whatsapp_clicked_at)} IST</p>
                    )}
                  </div>
                  {status && <Alert tone={status.tone}>{status.text}</Alert>}
                  {card ? (
                    <LeadActions talentId={lead.talent_id} firstName={card.masked_name.split(" ")[0]} view={view} refunded={refunded} />
                  ) : (
                    <p className="text-sm text-slate-500">This profile was paused or removed, so actions are unavailable.</p>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
