"use client";

import { notifyTalentOfUnlock } from "@/app/explore/notify-action";
import { useCallback, useEffect, useState } from "react";
import { PurchasePanel } from "@/components/explore/PurchasePanel";
import { fetchWallet, type Bundle, type Wallet } from "@/components/explore/wallet";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { costFor } from "@/lib/discovery/unlock-action";
import type { TalentCard } from "@/lib/discovery/cards";
import { friendlyMessage, rawMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { safeHttpUrl } from "@/lib/url";

type Contact = { full_name: string; whatsapp_number: string; portfolio_links: unknown[] };
type Step = "loading" | "confirm" | "buy" | "revealed" | "error";

/**
 * The whole unlock journey for one profile, as a small state machine:
 *   already unlocked ........ -> reveal (free, idempotent)
 *   enough credits / preview  -> confirm -> unlock_talent_contact() -> reveal
 *   not enough credits ...... -> buy credits (Razorpay) -> confirm -> unlock -> reveal
 * The charge happens ONLY inside the database function, atomically; this component never "deducts" anything itself.
 */
export function UnlockFlow({
  card,
  alreadyUnlocked,
  wallet,
  bundles,
  email,
  onWallet,
  onUnlocked,
  onClose,
}: {
  card: TalentCard;
  alreadyUnlocked: boolean;
  wallet: Wallet;
  bundles: Bundle[];
  email: string;
  onWallet: (w: Wallet) => void;
  onUnlocked: (talentId: string) => void;
  onClose: () => void;
}) {
  const initialQuote = card.quote!;
  const initialCost = costFor(initialQuote, wallet.trial);
  // The first screen is a pure function of what we already know, so compute it once instead of in an effect.
  const [step, setStep] = useState<Step>(
    alreadyUnlocked ? "loading" : initialCost.free || wallet.balance >= initialCost.credits ? "confirm" : "buy",
  );
  const [contact, setContact] = useState<Contact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const quote = card.quote!;
  const cost = costFor(quote, wallet.trial);
  const missing = Math.max(0, cost.credits - wallet.balance);

  const doUnlock = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const sb = createClient();
      const { data, error } = await sb.rpc("unlock_talent_contact", { p_talent_id: card.id });
      if (error) {
        // Someone else spent the credits in another tab, say: fall back to buying.
        if (rawMessage(error).includes("insufficient_credits")) {
          setStep("buy");
          return;
        }
        throw error;
      }
      setContact(data as Contact);
      onUnlocked(card.id);
      void notifyTalentOfUnlock(card.id); // e-mails the talent; never blocks or breaks the reveal
      onWallet(await fetchWallet(sb));
      setStep("revealed");
    } catch (e) {
      setError(friendlyMessage(e));
      setStep("error");
    } finally {
      setBusy(false);
    }
  }, [card.id, onUnlocked, onWallet]);

  // Re-viewing an unlocked profile is free and idempotent in the database; fetch it once on open.
  useEffect(() => {
    if (!alreadyUnlocked) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await createClient().rpc("unlock_talent_contact", { p_talent_id: card.id });
      if (cancelled) return;
      if (error) {
        setError(friendlyMessage(error));
        setStep("error");
      } else {
        setContact(data as Contact);
        setStep("revealed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [alreadyUnlocked, card.id]);

  const title = step === "revealed" ? "Contact details" : step === "buy" ? "Add credits" : `Unlock ${card.masked_name}`;

  return (
    <Modal open onClose={onClose} title={title}>
      {step === "loading" && <p className="py-6 text-center text-sm text-slate-600">One moment…</p>}

      {step === "confirm" && (
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-4 text-sm">
            <p className="font-medium text-slate-900">
              {card.masked_name} · {card.city} {quote.tier === "top_tier" && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Elite</span>}
            </p>
            <p className="mt-2 text-slate-700">
              {cost.free ? (
                <>This uses your <strong>free preview</strong>. No credits are spent.</>
              ) : (
                <>
                  Cost: <strong>{cost.credits} credit{cost.credits === 1 ? "" : "s"}</strong>. Balance {wallet.balance} → {wallet.balance - cost.credits}.
                </>
              )}
            </p>
          </div>
          <ul className="list-inside list-disc text-xs text-slate-600">
            <li>You get their full name, WhatsApp number and verified project links.</li>
            <li>If they don&apos;t reply, you can report it after 24 hours and get your credits back.</li>
          </ul>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={doUnlock} loading={busy}>{cost.free ? "Use free preview" : `Unlock for ${cost.credits} credit${cost.credits === 1 ? "" : "s"}`}</Button>
          </div>
        </div>
      )}

      {step === "buy" && (
        <div className="space-y-4">
          <Alert tone="info">
            You need <strong>{missing} more credit{missing === 1 ? "" : "s"}</strong> to unlock {card.masked_name}. Your balance is {wallet.balance}.
          </Alert>
          <PurchasePanel
            bundles={bundles}
            wallet={wallet}
            needed={missing}
            email={email}
            onPaid={(w) => {
              onWallet(w);
              setStep("confirm");
            }}
          />
        </div>
      )}

      {step === "revealed" && contact && <Revealed contact={contact} talentId={card.id} />}

      {step === "error" && (
        <div className="space-y-4">
          <Alert tone="error">{error}</Alert>
          <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
        </div>
      )}
    </Modal>
  );
}

function Revealed({ contact, talentId }: { contact: Contact; talentId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = contact.full_name.split(/\s+/)[0];
  const links = contact.portfolio_links.map(safeHttpUrl).filter((u): u is string => !!u);

  async function openWhatsApp() {
    setBusy(true);
    setError(null);
    try {
      // This call RECORDS the click: it is what later makes a "no reply" report possible.
      const { data, error } = await createClient().rpc("open_whatsapp", { p_talent_id: talentId });
      if (error) throw error;
      const text = encodeURIComponent(`Hi ${first}, I found you on DevMap.in and would like to discuss a project.`);
      window.open(`${data as string}?text=${text}`, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(friendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xl font-semibold text-slate-900">{contact.full_name}</p>
        <p className="text-sm text-slate-600">{contact.whatsapp_number}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button onClick={openWhatsApp} loading={busy}>Open WhatsApp</Button>
      </div>
      {links.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium text-slate-800">Portfolio &amp; live projects</p>
          <ul className="space-y-1 text-sm">
            {links.map((u) => (
              <li key={u}>
                <a href={u} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-emerald-700 underline">{u}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-xs text-slate-500">
        You can open this again any time from the profile; it won&apos;t cost anything. After you&apos;ve spoken, rate it or report no reply in{" "}
        <a href="/explore/leads" className="font-medium text-emerald-700 underline">My leads</a>.
      </p>
    </div>
  );
}
