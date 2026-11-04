import type { SupabaseClient } from "@supabase/supabase-js";
import { guardedGet, type GuardedOptions, type GuardedResponse } from "./net/fetch";
import { SsrfError } from "./net/guard";
import { isDefaultTemplate } from "./templates";

export type PingOutcome = { isUp: boolean; httpStatus: number | null; latencyMs: number | null; error: string | null };
type Getter = (url: string, opts?: GuardedOptions) => Promise<GuardedResponse>;

/** Short, storable reason for a failed fetch. Never includes URLs or addresses. */
export function describeError(e: unknown): string {
  if (e instanceof SsrfError) return e.message; // "blocked:private_address"
  const code = (e as { code?: string })?.code;
  const msg = e instanceof Error ? e.message : "";
  if (msg === "timeout" || msg === "too_many_redirects" || msg === "dns_failed") return msg;
  if (code && /CERT|TLS|SSL|ALTNAME/i.test(code)) return `tls:${code}`;
  if (/certificate|altnames|self.signed/i.test(msg)) return "tls:invalid_certificate";
  if (code) return `network:${code}`;
  return "network_error";
}

/**
 * One attempt: up = a 2xx answer over valid TLS that is not a stock template page.
 */
export async function attempt(url: string, get: Getter, opts?: GuardedOptions): Promise<PingOutcome> {
  try {
    const r = await get(url, opts);
    if (r.status < 200 || r.status >= 300) return { isUp: false, httpStatus: r.status, latencyMs: r.latencyMs, error: `http_${r.status}` };
    if (isDefaultTemplate(r.body.toString("utf8"))) return { isUp: false, httpStatus: r.status, latencyMs: r.latencyMs, error: "default_template" };
    return { isUp: true, httpStatus: r.status, latencyMs: r.latencyMs, error: null };
  } catch (e) {
    return { isUp: false, httpStatus: null, latencyMs: null, error: describeError(e) };
  }
}

/**
 * PRD §8.2: "up" if EITHER of two tries succeeds, so one transient blip is never counted as downtime.
 * A SSRF block is final (no retry: asking again cannot make a private address public).
 */
export async function pingProject(url: string, get: Getter = guardedGet, opts?: GuardedOptions, pauseMs = 750): Promise<PingOutcome> {
  const first = await attempt(url, get, opts);
  if (first.isUp || first.error?.startsWith("blocked:") || first.error === "default_template") return first;
  await new Promise((r) => setTimeout(r, pauseMs));
  const second = await attempt(url, get, opts);
  return second.isUp ? second : second.httpStatus === null && first.httpStatus !== null ? first : second;
}

export interface PingStore {
  claim(limit: number): Promise<{ project_id: string; live_url: string }[]>;
  record(projectId: string, o: PingOutcome): Promise<void>;
}

export function databasePingStore(admin: SupabaseClient): PingStore {
  return {
    async claim(limit) {
      const { data, error } = await admin.rpc("claim_ping_batch", { p_limit: limit });
      if (error) throw new Error(`claim_ping_batch failed: ${error.message}`);
      return (data ?? []) as { project_id: string; live_url: string }[];
    },
    async record(projectId, o) {
      const { error } = await admin.rpc("record_ping", {
        p_project: projectId,
        p_http_status: o.httpStatus,
        p_latency_ms: o.latencyMs,
        p_is_up: o.isUp,
        p_error: o.error,
      });
      if (error) throw new Error(`record_ping failed: ${error.message}`);
    },
  };
}

export type PingSummary = { claimed: number; up: number; down: number; blocked: number; budgetExhausted: boolean };

/** Pings a batch with bounded concurrency and a wall-clock budget (projects not reached keep their 10-minute lease and come back). */
export async function runPings(
  store: PingStore,
  opts: { limit?: number; concurrency?: number; budgetMs?: number; get?: Getter; pauseMs?: number } = {},
): Promise<PingSummary> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 45_000;
  const rows = await store.claim(opts.limit ?? 30);
  const out: PingSummary = { claimed: rows.length, up: 0, down: 0, blocked: 0, budgetExhausted: false };
  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      if (Date.now() - started > budgetMs) {
        out.budgetExhausted = true;
        return;
      }
      const o = await pingProject(row.live_url, opts.get ?? guardedGet, undefined, opts.pauseMs);
      await store.record(row.project_id, o);
      if (o.isUp) out.up++;
      else out.down++;
      if (o.error?.startsWith("blocked:")) out.blocked++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 10, Math.max(rows.length, 1)) }, worker));
  return out;
}
