import type { SupabaseClient } from "@supabase/supabase-js";
import type { GithubApi } from "./github";
import { guardedGet, type GuardedOptions, type GuardedResponse } from "./net/fetch";
import { parseProbeUrl } from "./net/guard";

type Getter = (url: string, opts?: GuardedOptions) => Promise<GuardedResponse>;

export type VerifyRow = { project_id: string; live_url: string; repo_url: string | null; verification_token: string; github_username: string | null };
export type Method = "well_known_file" | "github_homepage";

/** `https://<site>/devmap-verify.txt` must contain the line `devmap-verify=<token>` (PRD §8.1). */
export async function checkWellKnownFile(row: Pick<VerifyRow, "live_url" | "verification_token">, get: Getter = guardedGet, opts?: GuardedOptions): Promise<boolean> {
  try {
    const origin = parseProbeUrl(row.live_url).origin;
    const r = await get(`${origin}/devmap-verify.txt`, { ...opts, maxBytes: 4096 });
    if (r.status !== 200) return false;
    const want = `devmap-verify=${row.verification_token}`;
    return r.body.toString("utf8").split(/\r?\n/).some((line) => line.trim() === want);
  } catch {
    return false;
  }
}

/** Same address, ignoring case, a trailing slash and a fragment. Query strings still matter. */
export function sameSite(a: string, b: string): boolean {
  const norm = (s: string) => {
    try {
      const u = new URL(s.trim());
      return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
    } catch {
      return null;
    }
  };
  const na = norm(a);
  return na !== null && na === norm(b);
}

/** The repo must belong to the talent's OWN GitHub account and name this URL as its Homepage. */
export async function checkGithubHomepage(row: VerifyRow, gh: GithubApi): Promise<boolean> {
  if (!row.repo_url || !row.github_username) return false;
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?$/.exec(row.repo_url);
  if (!m || m[1].toLowerCase() !== row.github_username.toLowerCase()) return false;
  const res = await gh.get<{ homepage?: string | null; owner?: { login?: string } }>(`/repos/${m[1]}/${m[2]}`);
  if (res.status !== 200 || !res.data?.homepage) return false;
  if (res.data.owner?.login?.toLowerCase() !== row.github_username.toLowerCase()) return false;
  return sameSite(res.data.homepage, row.live_url);
}

export interface VerifyStore {
  claim(limit: number): Promise<VerifyRow[]>;
  markVerified(projectId: string, method: Method): Promise<"verified" | "url_already_verified">;
}

export function databaseVerifyStore(admin: SupabaseClient): VerifyStore {
  return {
    async claim(limit) {
      const { data, error } = await admin.rpc("claim_verification_batch", { p_limit: limit });
      if (error) throw new Error(`claim_verification_batch failed: ${error.message}`);
      return (data ?? []) as VerifyRow[];
    },
    async markVerified(projectId, method) {
      const { error } = await admin.rpc("mark_project_verified", { p_project: projectId, p_method: method });
      if (!error) return "verified";
      if (error.message.includes("url_already_verified")) return "url_already_verified";
      throw new Error(`mark_project_verified failed: ${error.message}`);
    },
  };
}

export type VerifySummary = { claimed: number; verified: number; taken: number; pending: number };

export async function runVerification(store: VerifyStore, gh: GithubApi, opts: { limit?: number; get?: Getter } = {}): Promise<VerifySummary> {
  const rows = await store.claim(opts.limit ?? 20);
  const out: VerifySummary = { claimed: rows.length, verified: 0, taken: 0, pending: 0 };
  for (const row of rows) {
    // Cheapest first: the well-known file costs no GitHub quota.
    let method: Method | null = null;
    if (await checkWellKnownFile(row, opts.get)) method = "well_known_file";
    else if (await checkGithubHomepage(row, gh).catch(() => false)) method = "github_homepage";
    if (!method) {
      out.pending++;
      continue;
    }
    const r = await store.markVerified(row.project_id, method);
    if (r === "verified") out.verified++;
    else out.taken++;
  }
  return out;
}
