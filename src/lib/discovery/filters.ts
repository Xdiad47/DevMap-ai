import type { Role } from "@/lib/constants";
import { findCity, isState } from "@/lib/geo/india";
import { LANGUAGES } from "@/lib/languages";
import { getIntent, type IntentId } from "./intents";

/**
 * The search filters, as they appear in the URL (?role=designer&city=Surat&online=1).
 * Keeping them in the URL makes a search shareable, bookmarkable and server-rendered.
 *
 * Every value is validated against a known list. That matters twice: it stops junk in the URL, and the
 * language/city strings are later placed inside a PostgREST filter expression, so they must be safe.
 */
export type Filters = {
  intent?: IntentId;
  role?: Role;
  state?: string; // optional: with no state and no city the search covers all of India
  city?: string;
  language?: string;
  online: boolean;
  maxRate?: number; // rupees per hour
};

export const DEFAULT_FILTERS: Filters = { online: false };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseFilters(params: Params): Filters {
  const intent = getIntent(first(params.intent))?.id;
  const roleRaw = first(params.role);
  const role = roleRaw === "developer" || roleRaw === "designer" || roleRaw === "marketer" ? roleRaw : undefined;
  // A city always carries its state; a state on its own is allowed. A city outside the chosen state is dropped, not trusted.
  const stateRaw = first(params.state);
  const cityRow = findCity(first(params.city));
  const city = cityRow && (!isState(stateRaw) || cityRow.state === stateRaw) ? cityRow.name : undefined;
  const state = city ? cityRow!.state : isState(stateRaw) ? stateRaw : undefined;
  const language = LANGUAGES.find((l) => l === first(params.language));
  const rate = Number(first(params.maxRate));
  return {
    state,
    // An intent already implies roles, so the two are mutually exclusive: intent wins.
    intent,
    role: intent ? undefined : role,
    city,
    language,
    online: first(params.online) === "1",
    maxRate: Number.isInteger(rate) && rate >= 300 && rate <= 100000 ? rate : undefined,
  };
}

/** Only non-default values go in the URL, so links stay short and clean. */
export function toSearchParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.intent) p.set("intent", f.intent);
  if (f.role && !f.intent) p.set("role", f.role);
  if (f.state && !f.city) p.set("state", f.state); // a city already implies its state
  if (f.city) p.set("city", f.city);
  if (f.language) p.set("language", f.language);
  if (f.online) p.set("online", "1");
  if (f.maxRate) p.set("maxRate", String(f.maxRate));
  return p;
}

export function hasActiveFilters(f: Filters): boolean {
  return !!(f.intent || f.role || f.state || f.city || f.language || f.online || f.maxRate);
}
