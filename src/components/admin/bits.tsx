import type { ReactNode } from "react";
import type { Evidence } from "@/lib/admin/evidence";
import type { TalentFile } from "@/lib/admin/queue";
import { formatWhen } from "@/lib/leads/status";
import { safeHttpUrl } from "@/lib/url";

export const when = (iso: string | null) => (iso ? `${formatWhen(iso)} IST` : "–");

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

/** Links open with rel=noopener+nofollow; anything else is inert text. */
export function EvidenceList({ items }: { items: Evidence[] }) {
  if (items.length === 0) return <p className="text-sm text-slate-500">No evidence was attached.</p>;
  return (
    <ul className="space-y-3">
      {items.map((e, i) => (
        <li key={i} className="text-sm">
          {e.kind === "link" && <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-emerald-700 underline">{e.url}</a>}
          {e.kind === "text" && <span className="text-slate-700">{e.text}</span>}
        </li>
      ))}
    </ul>
  );
}

export function LinkList({ links }: { links: unknown }) {
  const urls = Array.isArray(links) ? links.filter((l): l is string => typeof l === "string") : [];
  if (urls.length === 0) return <span className="text-slate-500">none</span>;
  return (
    <ul className="space-y-1">
      {urls.map((u) => (
        <li key={u}><SafeLink url={u} /></li>
      ))}
    </ul>
  );
}

export function SafeLink({ url }: { url: string }) {
  const safe = safeHttpUrl(url);
  return safe ? <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-emerald-700 underline">{safe}</a> : <span className="break-all text-slate-600">{url.slice(0, 200)}</span>;
}

export function TalentBlock({ t }: { t: TalentFile }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <Field label="Real name">{t.full_name ?? "–"} <span className="text-slate-500">(shown to recruiters as {t.masked_name})</span></Field>
      <Field label="Role · place">{t.role} · {t.city}, {t.state}</Field>
      <Field label="GitHub">{t.github_username ?? "–"}</Field>
      <Field label="Status">
        {t.is_banned ? "BANNED" : t.suspended_until && new Date(t.suspended_until) > new Date() ? `suspended until ${when(t.suspended_until)}` : t.is_listed ? "listed" : "not listed"} · review: {t.review_status} · proof {t.proof_score}
      </Field>
      <Field label="Skills">{t.skills.join(", ") || "–"}</Field>
      <Field label="Portfolio links"><LinkList links={t.portfolio_links} /></Field>
      {t.projects.length > 0 && (
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Projects</dt>
          <dd className="mt-1 space-y-1 text-sm">
            {t.projects.map((p) => (
              <p key={p.live_url}>
                <strong>{p.generic_title}</strong> · <SafeLink url={p.live_url} /> · {p.is_ownership_verified ? `verified (${p.verification_method}), uptime ${p.uptime_30d}%` : "not verified"}
              </p>
            ))}
          </dd>
        </div>
      )}
      {t.strikes.length > 0 && (
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Strikes</dt>
          <dd className="mt-1 text-sm">{t.strikes.map((s) => `${s.status} (${when(s.created_at)}, expires ${when(s.expires_at)})`).join(" · ")}</dd>
        </div>
      )}
    </dl>
  );
}
