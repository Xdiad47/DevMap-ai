"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { FiltersBar } from "@/components/explore/FiltersBar";
import { TalentCardView } from "@/components/explore/TalentCard";
import { PurchasePanel } from "@/components/explore/PurchasePanel";
import { UnlockFlow } from "@/components/explore/UnlockFlow";
import type { Bundle, Wallet } from "@/components/explore/wallet";
import type { MapPin } from "@/components/explore/TalentMap";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Modal } from "@/components/ui/modal";
import { ROLE_STYLE } from "@/lib/role-style";
import type { Role } from "@/lib/constants";
import type { TalentCard } from "@/lib/discovery/cards";
import type { Filters } from "@/lib/discovery/filters";
import type { UnlockStatus } from "@/lib/discovery/unlock-action";

// Leaflet touches `window`, so it must never render on the server.
const TalentMap = dynamic(() => import("@/components/explore/TalentMap"), {
  ssr: false,
  loading: () => <div className="flex h-full min-h-[22rem] items-center justify-center bg-gradient-to-br from-sky-100 to-indigo-100 text-sm font-medium text-indigo-700">Loading map…</div>,
});

export function ExploreClient({
  cards,
  total,
  filters,
  notice,
  roleCounts,
  initialWallet,
  initialUnlocks,
  bundles,
  email,
  mockPayments,
  companyName,
}: {
  cards: TalentCard[];
  total: number;
  filters: Filters;
  notice: string | null;
  roleCounts: Record<Role, number>;
  initialWallet: Wallet;
  initialUnlocks: Record<string, UnlockStatus>;
  bundles: Bundle[];
  email: string;
  mockPayments: boolean;
  companyName: string | null;
}) {
  const router = useRouter();
  // Local state starts from the server's values. The page keys this component on those values, so a fresh
  // server render (new search, or router.refresh() after a purchase) re-mounts it with the authoritative numbers.
  const [wallet, setWallet] = useState(initialWallet);
  const [unlocks, setUnlocks] = useState(initialUnlocks);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flowCard, setFlowCard] = useState<TalentCard | null>(null);
  const [tab, setTab] = useState<"list" | "map">("list");
  const [buyOnly, setBuyOnly] = useState(false);
  const unlockCount = Object.keys(unlocks).length;

  const pins: MapPin[] = useMemo(
    () => cards.filter((c) => c.latitude != null && c.longitude != null).map((c) => ({ id: c.id, lat: c.latitude!, lng: c.longitude!, city: c.city, online: c.is_online, role: c.role, label: `${c.masked_name}, ${c.city}` })),
    [cards],
  );

  const select = useCallback((id: string) => {
    setSelectedId(id);
    document.getElementById(`card-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const onlineNow = cards.filter((c) => c.is_online).length;

  return (
    <div className="space-y-6">
      {mockPayments && (
        <Alert tone="warn">
          <strong>Test payments are ON</strong> (RAZORPAY_MODE=mock). No real money moves. This banner never appears in production.
        </Alert>
      )}

      {/* Hero strip: who you are, what you have, where to go next */}
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600 p-6 text-white shadow-lg sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 size-64 rounded-full bg-white/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 right-40 size-56 rounded-full bg-pink-400/20" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-xl">
            <p className="text-sm font-medium text-white/80">{companyName ?? "Your account"}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Find someone great, nearby.</h1>
            <p className="mt-2 text-white/90">
              Verified developers, designers and marketers who speak your language and are free today.{" "}
              <span className="font-semibold">{onlineNow} online right now.</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl bg-white/15 px-4 py-2.5 text-center backdrop-blur">
              <p className="text-[11px] uppercase tracking-wide text-white/80">Credits</p>
              <p className="text-2xl font-bold leading-tight">{wallet.balance}</p>
            </div>
            <div className="rounded-2xl bg-white/15 px-4 py-2.5 text-center backdrop-blur">
              <p className="text-[11px] uppercase tracking-wide text-white/80">Free preview</p>
              <p className="text-2xl font-bold leading-tight">{wallet.trial}</p>
            </div>
            <Button onClick={() => setBuyOnly(true)} className="bg-none bg-white !text-emerald-700 shadow-md hover:bg-emerald-50 hover:brightness-100">Buy credits</Button>
            <Link href="/explore/leads" className="rounded-lg px-3 py-2.5 text-sm font-semibold text-white ring-1 ring-white/50 hover:bg-white/10">
              My leads{unlockCount > 0 ? ` (${unlockCount})` : ""} →
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile: switch between list and map. Desktop: text on the left, map on the right. */}
      <div className="flex gap-2 lg:hidden" role="tablist">
        {(["list", "map"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold", tab === t ? "bg-indigo-600 text-white shadow" : "bg-white text-slate-700 ring-1 ring-slate-300")}>
            {t === "list" ? `List (${cards.length})` : "Map"}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className={cn("space-y-5", tab === "map" && "hidden lg:block")}>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <FiltersBar filters={filters} roleCounts={roleCounts} total={total} />
          </div>

          {notice && <Alert tone="info">{notice}</Alert>}

          <div className="space-y-4">
            {cards.length === 0 ? (
              <EmptyState filters={filters} />
            ) : (
              cards.map((c) => (
                <TalentCardView
                  key={c.id}
                  card={c}
                  status={unlocks[c.id] ?? "none"}
                  trialLeft={wallet.trial}
                  selected={selectedId === c.id}
                  onSelect={() => setSelectedId(c.id)}
                  onUnlock={() => setFlowCard(c)}
                />
              ))
            )}
          </div>
        </div>

        <div className={cn("lg:sticky lg:top-4", tab === "list" && "hidden lg:block")}>
          <div className="relative h-[70vh] min-h-[26rem] overflow-hidden rounded-3xl border-4 border-white shadow-xl ring-1 ring-slate-200 lg:h-[calc(100vh-2rem)]">
            <TalentMap pins={pins} selectedId={selectedId} onSelect={select} />
            <MapLegend count={pins.length} />
          </div>
        </div>
      </div>

      {flowCard && flowCard.quote && (
        <UnlockFlow
          key={flowCard.id}
          card={flowCard}
          alreadyUnlocked={unlocks[flowCard.id] === "unlocked"}
          wallet={wallet}
          bundles={bundles}
          email={email}
          onWallet={setWallet}
          onUnlocked={(id) => setUnlocks((u) => ({ ...u, [id]: "unlocked" }))}
          onClose={() => {
            setFlowCard(null);
            router.refresh(); // pull the authoritative balance + unlock list
          }}
        />
      )}

      {buyOnly && (
        <BuyCreditsDialog
          bundles={bundles}
          wallet={wallet}
          email={email}
          onWallet={setWallet}
          onClose={() => {
            setBuyOnly(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** Floats over the map: what the colours mean. Pins are city centres, never addresses. */
function MapLegend({ count }: { count: number }) {
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-[500] rounded-2xl bg-white/90 px-4 py-3 text-xs shadow-lg backdrop-blur">
      <p className="mb-1.5 font-semibold text-slate-800">{count} on the map</p>
      <ul className="space-y-1">
        {(Object.keys(ROLE_STYLE) as Role[]).map((r) => (
          <li key={r} className="flex items-center gap-2 text-slate-700">
            <span className="size-3 rounded-full" style={{ background: ROLE_STYLE[r].hex }} /> {ROLE_STYLE[r].label}
          </li>
        ))}
        <li className="flex items-center gap-2 border-t border-slate-200 pt-1 text-slate-700">
          <span className="size-3 rounded-full bg-emerald-500 shadow-[0_0_8px_3px_rgba(16,185,129,.6)]" /> Online now
        </li>
      </ul>
      <p className="mt-1.5 text-[10px] text-slate-500">Pins show the city, never an address.</p>
    </div>
  );
}

function EmptyState({ filters }: { filters: Filters }) {
  return (
    <div className="rounded-3xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 p-8 text-center">
      <p className="font-semibold text-slate-900">No builders match yet.</p>
      <p className="mt-1 text-sm text-slate-600">
        {filters.language
          ? `We never drop the language you chose. Try a different language, or remove other filters.`
          : "Try removing a filter. New profiles join every week, and most builders work remotely, so someone in another city can still help."}
      </p>
      <p className="mt-2 text-xs text-slate-500">You are never charged for searching, only when you unlock a contact.</p>
    </div>
  );
}


function BuyCreditsDialog({ bundles, wallet, email, onWallet, onClose }: { bundles: Bundle[]; wallet: Wallet; email: string; onWallet: (w: Wallet) => void; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Buy credits">
      <PurchasePanel
        bundles={bundles}
        wallet={wallet}
        needed={0}
        email={email}
        onPaid={(w) => {
          onWallet(w);
          onClose();
        }}
      />
    </Modal>
  );
}
