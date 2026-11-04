import { Avatar } from "@/components/explore/Avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ROLES } from "@/lib/constants";
import { ROLE_STYLE } from "@/lib/role-style";
import { unlockAction, type UnlockStatus } from "@/lib/discovery/unlock-action";
import type { TalentCard as Card } from "@/lib/discovery/cards";

const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.value, r.label]));

export function TalentCardView({
  card,
  status,
  trialLeft,
  selected,
  onSelect,
  onUnlock,
}: {
  card: Card;
  status: UnlockStatus;
  trialLeft: number;
  selected: boolean;
  onSelect: () => void;
  onUnlock: () => void;
}) {
  const action = unlockAction(card, status, trialLeft);
  const elite = card.quote?.tier === "top_tier";
  const languages = [card.native_language, ...card.secondary_languages];
  const rs = ROLE_STYLE[card.role];

  return (
    <article
      id={`card-${card.id}`}
      onClick={onSelect}
      className={cn(
        "cursor-pointer rounded-3xl border border-l-[6px] bg-gradient-to-br to-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg",
        rs.bar,
        rs.soft,
        selected ? "border-y-indigo-500 border-r-indigo-500 shadow-lg ring-2 ring-indigo-500/30" : "border-y-slate-200 border-r-slate-200",
      )}
    >
      <div className="flex gap-3">
        <Avatar id={card.id} maskedName={card.masked_name} locked={status !== "unlocked"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-semibold text-slate-900">{card.masked_name}</h3>
            {card.is_online ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_6px_2px_rgba(16,185,129,.5)]" /> Online now
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                <span className="size-2 rounded-full bg-slate-300" /> Offline
              </span>
            )}
            {elite && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Elite</span>}
            {card.review_status !== "unverified" && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                {card.review_status === "verified" ? "Verified portfolio" : "Reviewed portfolio"}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600">
            <span className={cn("mr-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", rs.chip)}>{ROLE_LABEL[card.role]}</span>
            {card.city}
            {card.state_rank && card.state_cohort_size ? ` · #${card.state_rank} of ${card.state_cohort_size} in ${card.state}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-xl font-bold text-transparent">₹{Math.round(card.hourly_rate_paise / 100)}</p>
          <p className="-mt-1 text-xs text-slate-500">per hour</p>
        </div>
      </div>

      <dl className="mt-3 grid gap-1.5 text-sm">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-slate-500">Speaks</dt>
          <dd className="text-slate-800">{languages.join(", ")}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-slate-500">Skills</dt>
          <dd className="flex flex-wrap gap-1">
            {card.skills.map((s) => (
              <span key={s} className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                {s.replaceAll("-", " ")}
              </span>
            ))}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-slate-500">Proof</dt>
          <dd className="text-slate-800">
            {card.projects.length > 0 ? (
              <ul className="space-y-0.5">
                {card.projects.slice(0, 3).map((p) => (
                  <li key={p.generic_title}>
                    ✓ {p.generic_title} <span className="text-xs text-slate-500">· {Math.round(p.uptime_30d)}% uptime</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-slate-500">No verified live project yet</span>
            )}
            <span className="mt-1 block text-xs text-slate-500">
              Score {Number(card.composite_rank_score).toFixed(0)}/100 · Responsiveness {card.response_velocity_score}/100
            </span>
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {status === "unlocked" ? "Unlocked ✓" : "Name, photo, WhatsApp and links are hidden until you unlock."}
        </p>
        <Button
          variant={action.variant}
          disabled={action.disabled}
          onClick={(e) => {
            e.stopPropagation();
            onUnlock();
          }}
        >
          {action.label}
        </Button>
      </div>
    </article>
  );
}
