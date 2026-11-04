import type { Metadata } from "next";
import { ExploreClient } from "@/components/explore/ExploreClient";
import type { UnlockStatus } from "@/lib/discovery/unlock-action";
import { Card } from "@/components/ui/card";
import { enforceRecruiter } from "@/lib/auth/viewer";
import { attachCardExtras } from "@/lib/discovery/cards";
import { parseFilters, toSearchParams } from "@/lib/discovery/filters";
import { searchTalent } from "@/lib/discovery/search";
import { BUNDLE_COLUMNS, LEDGER_COLUMNS, UNLOCK_COLUMNS } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Explore talent" };

const REASON_LABEL: Record<string, string> = {
  trial_grant: "Free preview granted",
  purchase: "Credits purchased",
  unlock_standard: "Unlocked a profile",
  unlock_top: "Unlocked an elite profile",
  unlock_trial: "Used free preview",
  ghost_refund: "Refund (no reply)",
  admin_adjustment: "Adjustment",
};

export default async function ExplorePage({ searchParams }: PageProps<"/explore">) {
  const { user, recruiter } = await enforceRecruiter("/explore");
  const requested = parseFilters(await searchParams);
  const sb = await createClient();

  // Everything below runs AS the signed-in recruiter. Row Level Security decides what they can see.
  const outcome = await searchTalent(sb, requested);
  const [cards, unlockRes, bundleRes, ledgerRes] = await Promise.all([
    attachCardExtras(sb, outcome.rows),
    sb.from("lead_unlocks").select(UNLOCK_COLUMNS),
    sb.from("credit_bundles").select(BUNDLE_COLUMNS).order("sort_order"),
    sb.from("credits_ledger").select(LEDGER_COLUMNS).order("created_at", { ascending: false }).limit(10),
  ]);
  for (const r of [unlockRes, bundleRes, ledgerRes]) if (r.error) throw new Error(`explore data failed: ${r.error.message}`);

  const unlocks: Record<string, UnlockStatus> = {};
  for (const u of (unlockRes.data ?? []) as { talent_id: string; refunded_at: string | null }[]) {
    unlocks[u.talent_id] = u.refunded_at ? "refunded" : "unlocked";
  }

  // Mock payments are a LOCAL development convenience; getPaymentConfig() also hard-refuses it in production.
  const mockPayments = process.env.RAZORPAY_MODE === "mock" && process.env.NODE_ENV !== "production";

  return (
    // Break out of the site's narrow reading column: this screen is a split view and wants the full width.
    <div className="relative left-1/2 w-screen -translate-x-1/2 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
      <ExploreClient
        key={`${toSearchParams(requested)}|${recruiter.credits_balance}|${recruiter.trial_unlocks_remaining}|${Object.keys(unlocks).length}`}
        cards={cards}
        total={outcome.total}
        filters={requested}
        notice={outcome.notice}
        roleCounts={outcome.roleCounts}
        initialWallet={{ balance: recruiter.credits_balance, trial: recruiter.trial_unlocks_remaining }}
        initialUnlocks={unlocks}
        bundles={(bundleRes.data ?? []) as { id: string; label: string; credits: number; price_paise: number }[]}
        email={user.email ?? ""}
        mockPayments={mockPayments}
        companyName={recruiter.company_name}
      />

      <Card className="rounded-3xl">
        <details>
          <summary className="cursor-pointer text-sm font-semibold">Credit history</summary>
          {ledgerRes.data && ledgerRes.data.length > 0 ? (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {ledgerRes.data.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{REASON_LABEL[row.reason as string] ?? row.reason}</span>
                  <span className="text-slate-500">
                    {row.delta > 0 ? `+${row.delta}` : row.delta} → {row.balance_after}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Nothing yet.</p>
          )}
        </details>
      </Card>
      </div>
    </div>
  );
}
