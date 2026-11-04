"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/components/ui/cn";
import { Select } from "@/components/ui/field";
import { ROLES, type Role } from "@/lib/constants";
import { hasActiveFilters, toSearchParams, type Filters } from "@/lib/discovery/filters";
import { INTENTS, type IntentId } from "@/lib/discovery/intents";
import { STATES, citiesOf } from "@/lib/geo/india";
import { LANGUAGES } from "@/lib/languages";
import { ROLE_STYLE } from "@/lib/role-style";

const RATE_STEPS = [500, 750, 1000, 1500];

/** Every control rewrites the URL; the server re-runs the search. That keeps results shareable and fully server-rendered. */
export function FiltersBar({ filters, roleCounts, total }: { filters: Filters; roleCounts: Record<Role, number>; total: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const go = (next: Filters) => {
    const qs = toSearchParams(next).toString();
    start(() => router.push(qs ? `/explore?${qs}` : "/explore", { scroll: false }));
  };
  // An intent already implies roles, so picking one clears the role and vice versa.
  const setIntent = (id: IntentId | undefined) => go({ ...filters, intent: id, role: undefined });
  const setRole = (role: Role | undefined) => go({ ...filters, role, intent: undefined });
  const allCount = roleCounts.developer + roleCounts.designer + roleCounts.marketer;

  return (
    <section aria-label="Find talent" className={cn("space-y-4", pending && "opacity-70")}>
      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-indigo-700">What do you need?</h2>
        <div className="flex flex-wrap gap-2">
          {INTENTS.map((i) => (
            <button
              key={i.id}
              type="button"
              title={i.hint}
              aria-pressed={filters.intent === i.id}
              onClick={() => setIntent(filters.intent === i.id ? undefined : i.id)}
              className={cn(
                "rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                filters.intent === i.id
                  ? "border-transparent bg-gradient-to-r from-emerald-500 to-indigo-600 text-white shadow-md"
                  : "border-slate-200 bg-slate-50 text-slate-800 hover:border-indigo-300 hover:bg-indigo-50",
              )}
            >
              {i.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip active={!filters.role && !filters.intent} onClick={() => setRole(undefined)}>
          Everyone ({allCount})
        </Chip>
        {ROLES.map((r) => (
          <Chip key={r.value} active={filters.role === r.value} activeClass={ROLE_STYLE[r.value].active} dot={ROLE_STYLE[r.value].hex} onClick={() => setRole(r.value)}>
            {r.label}s ({roleCounts[r.value]})
          </Chip>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-medium text-slate-600">
          State
          {/* Changing the state clears the city: a city only makes sense inside its own state. */}
          <Select aria-label="State" value={filters.state ?? ""} onChange={(e) => go({ ...filters, state: e.target.value || undefined, city: undefined })} className="mt-1">
            <option value="">All of India</option>
            {STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          City
          <Select aria-label="City" value={filters.city ?? ""} disabled={!filters.state} onChange={(e) => go({ ...filters, city: e.target.value || undefined })} className="mt-1">
            <option value="">{filters.state ? `All of ${filters.state}` : "Choose a state first"}</option>
            {citiesOf(filters.state).map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </Select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Language
          <Select aria-label="Language" value={filters.language ?? ""} onChange={(e) => go({ ...filters, language: e.target.value || undefined })} className="mt-1">
            <option value="">Any language</option>
            {LANGUAGES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </Select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Budget
          <Select aria-label="Maximum hourly rate" value={filters.maxRate ?? ""} onChange={(e) => go({ ...filters, maxRate: e.target.value ? Number(e.target.value) : undefined })} className="mt-1">
            <option value="">Any rate</option>
            {RATE_STEPS.map((r) => (
              <option key={r} value={r}>
                Up to ₹{r}/hr
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-end gap-2 pb-2.5 text-sm font-medium text-slate-800">
          <input
            type="checkbox"
            checked={filters.online}
            onChange={(e) => go({ ...filters, online: e.target.checked })}
            className="size-4 accent-emerald-600"
          />
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_6px_2px_rgba(16,185,129,.5)]" /> Online now
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-600" aria-live="polite">
        <span>
          {total} {total === 1 ? "builder" : "builders"} found{pending ? "…" : ""}
        </span>
        {hasActiveFilters(filters) && (
          <button type="button" className="font-medium text-emerald-700 underline" onClick={() => go({ online: false })}>
            Clear filters
          </button>
        )}
      </div>
    </section>
  );
}

function Chip({ active, onClick, children, activeClass, dot }: { active: boolean; onClick: () => void; children: React.ReactNode; activeClass?: string; dot?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        "inline-flex items-center gap-1.5",
        active ? (activeClass ?? "bg-slate-900 text-white") : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50",
      )}
    >
      {dot && <span className="size-2.5 rounded-full ring-2 ring-white" style={{ background: dot }} />}
      {children}
    </button>
  );
}
