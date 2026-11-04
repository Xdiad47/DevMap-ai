import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * GitHub scorer (PRD §7.2). Counts, for the last 90 days, commits that are:
 *   - AUTHORED by the talent's GitHub account      (`?author=<login>`: unlinked emails don't count)
 *   - in repositories the talent OWNS and did not fork
 *   - on the default branch                        (the commits API default)
 *   - at most 15 per day (all repos together)
 *   - in repos with >= 2 distinct active days      (one-day bursts are ignored)
 *   - not "lockfile / README only"                 (checked on a sample, see countNonTrivial)
 * and hands the count to the database, which turns it into points (`private.commit_points`).
 */
export type GithubResponse<T> = { status: number; data: T | null };
export interface GithubApi {
  get<T>(path: string): Promise<GithubResponse<T>>;
}

export class RateLimitError extends Error {
  constructor() {
    super("github_rate_limited");
  }
}

export function createGithubApi(token: string | undefined, doFetch: typeof fetch = fetch): GithubApi {
  return {
    async get<T>(path: string) {
      const res = await doFetch(`https://api.github.com${path}`, {
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "DevMapBot/1.0 (+https://devmap.in/bot)",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) throw new RateLimitError();
      if (res.status === 404) return { status: 404, data: null };
      if (!res.ok) return { status: res.status, data: null };
      return { status: res.status, data: (await res.json()) as T };
    },
  };
}

export const WINDOW_DAYS = 90;
export const DAILY_CAP = 15;
export const MIN_ACTIVE_DAYS = 2;
export const MAX_REPOS = 12;
export const MAX_PAGES_PER_REPO = 3;
export const DETAIL_BUDGET = 40;

export type Commit = { sha: string; repo: string; at: string };

const LOCKFILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Gemfile\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Cargo\.lock|go\.sum|pubspec\.lock|Podfile\.lock|gradle\.lockfile)$/i;
const README = /(^|\/)readme(\.[a-z]+)?$/i;

/** A commit that only touches lockfiles and/or READMEs (or nothing at all) shows no real work. */
export function isTrivialCommit(files: string[]): boolean {
  return files.every((f) => LOCKFILES.test(f) || README.test(f));
}

/** Rules that need no extra API calls: ≥2 active days per repo, then ≤15 commits per calendar day overall. */
export function applyStructuralRules(commits: Commit[]): Commit[] {
  const day = (c: Commit) => c.at.slice(0, 10); // UTC calendar day
  const perRepoDays = new Map<string, Set<string>>();
  for (const c of commits) {
    if (!perRepoDays.has(c.repo)) perRepoDays.set(c.repo, new Set());
    perRepoDays.get(c.repo)!.add(day(c));
  }
  const eligible = commits.filter((c) => (perRepoDays.get(c.repo)?.size ?? 0) >= MIN_ACTIVE_DAYS);
  // Newest first so that, if a day exceeds the cap, the kept commits are deterministic.
  eligible.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.sha.localeCompare(b.sha)));
  const perDay = new Map<string, number>();
  const kept: Commit[] = [];
  for (const c of eligible) {
    const n = perDay.get(day(c)) ?? 0;
    if (n >= DAILY_CAP) continue;
    perDay.set(day(c), n + 1);
    kept.push(c);
  }
  return kept;
}

/**
 * Whether a commit is lockfile/README-only needs one API call per commit, which is too many for a busy account.
 * So: up to DETAIL_BUDGET commits are inspected, chosen at even spacing across ALL candidates (no cherry-picking
 * possible), and the non-trivial share of that sample is applied to the whole set. An account padded with
 * README edits shows a low share and loses those commits; a real one keeps nearly all of them.
 */
export async function countNonTrivial(candidates: Commit[], filesOf: (c: Commit) => Promise<string[]>): Promise<{ counted: number; sampled: number }> {
  if (candidates.length === 0) return { counted: 0, sampled: 0 };
  const n = Math.min(DETAIL_BUDGET, candidates.length);
  const picks = Array.from({ length: n }, (_, i) => candidates[Math.floor((i * candidates.length) / n)]);
  let real = 0;
  for (const c of picks) if (!isTrivialCommit(await filesOf(c))) real++;
  return { counted: n === candidates.length ? real : Math.round((candidates.length * real) / n), sampled: n };
}

type RepoInfo = { name: string; fork: boolean; disabled?: boolean; pushed_at: string | null; size?: number };
type CommitInfo = { sha: string; commit: { author: { date: string } | null } };
type CommitDetail = { files?: { filename: string }[] };

export type GithubScore = { commits90d: number; lastCommitAt: string | null; meta: Record<string, unknown> };

export class GithubNotFound extends Error {
  constructor() {
    super("not_found");
  }
}

export async function scoreDeveloper(gh: GithubApi, login: string, now: Date = new Date()): Promise<GithubScore> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const repos = await gh.get<RepoInfo[]>(`/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&direction=desc&per_page=100`);
  if (repos.status === 404) throw new GithubNotFound();
  if (repos.status !== 200 || !repos.data) throw new Error(`github_${repos.status}`);

  const active = repos.data.filter((r) => !r.fork && !r.disabled && r.pushed_at && r.pushed_at >= since).slice(0, MAX_REPOS);
  const all: Commit[] = [];
  for (const repo of active) {
    for (let page = 1; page <= MAX_PAGES_PER_REPO; page++) {
      const res = await gh.get<CommitInfo[]>(
        `/repos/${encodeURIComponent(login)}/${encodeURIComponent(repo.name)}/commits?author=${encodeURIComponent(login)}&since=${encodeURIComponent(since)}&per_page=100&page=${page}`,
      );
      if (res.status === 409 || res.status === 404) break; // empty repo / vanished
      if (res.status !== 200 || !res.data) throw new Error(`github_${res.status}`);
      for (const c of res.data) if (c.commit.author?.date) all.push({ sha: c.sha, repo: repo.name, at: new Date(c.commit.author.date).toISOString() });
      if (res.data.length < 100) break;
    }
  }

  const inWindow = all.filter((c) => c.at >= since && c.at <= now.toISOString());
  const candidates = applyStructuralRules(inWindow);
  const { counted, sampled } = await countNonTrivial(candidates, async (c) => {
    const d = await gh.get<CommitDetail>(`/repos/${encodeURIComponent(login)}/${encodeURIComponent(c.repo)}/commits/${c.sha}`);
    if (d.status !== 200 || !d.data) throw new Error(`github_${d.status}`);
    return (d.data.files ?? []).map((f) => f.filename);
  });

  const last = inWindow.reduce<string | null>((m, c) => (m === null || c.at > m ? c.at : m), null);
  return {
    commits90d: counted,
    lastCommitAt: last,
    meta: {
      github_repos_scanned: active.length,
      github_commits_seen: inWindow.length,
      github_commits_after_rules: candidates.length,
      github_commits_sampled: sampled,
    },
  };
}

export interface GithubStore {
  queue(limit: number): Promise<{ talent_id: string; github_username: string }[]>;
  setWorkDepth(talentId: string, s: GithubScore, nowIso: string): Promise<void>;
  recordFailure(talentId: string, reason: string): Promise<void>;
}

export function databaseGithubStore(admin: SupabaseClient): GithubStore {
  return {
    async queue(limit) {
      const { data, error } = await admin.rpc("github_scoring_queue", { p_limit: limit });
      if (error) throw new Error(`github_scoring_queue failed: ${error.message}`);
      return (data ?? []) as { talent_id: string; github_username: string }[];
    },
    async setWorkDepth(talentId, s, nowIso) {
      const { error } = await admin.rpc("set_work_depth_from_commits", {
        p_talent: talentId,
        p_commits_90d: s.commits90d,
        p_last_commit_at: s.lastCommitAt,
        p_meta: { ...s.meta, github_scored_at: nowIso, github_error: null },
      });
      if (error) throw new Error(`set_work_depth_from_commits failed: ${error.message}`);
    },
    async recordFailure(talentId, reason) {
      const { error } = await admin.rpc("record_github_failure", { p_talent: talentId, p_error: reason });
      if (error) throw new Error(`record_github_failure failed: ${error.message}`);
    },
  };
}

export type GithubSummary = { queued: number; scored: number; notFound: number; failed: number; rateLimited: boolean };

export async function runGithubScoring(store: GithubStore, gh: GithubApi, opts: { limit?: number; now?: () => Date } = {}): Promise<GithubSummary> {
  const rows = await store.queue(opts.limit ?? 5);
  const out: GithubSummary = { queued: rows.length, scored: 0, notFound: 0, failed: 0, rateLimited: false };
  for (const row of rows) {
    const now = opts.now?.() ?? new Date();
    try {
      const score = await scoreDeveloper(gh, row.github_username, now);
      await store.setWorkDepth(row.talent_id, score, now.toISOString());
      out.scored++;
    } catch (e) {
      if (e instanceof RateLimitError) {
        out.rateLimited = true; // stop; do NOT stamp anyone as scored, they stay at the front of the queue
        break;
      }
      const reason = e instanceof GithubNotFound ? "not_found" : "api_error";
      await store.recordFailure(row.talent_id, reason);
      if (e instanceof GithubNotFound) out.notFound++;
      else out.failed++;
    }
  }
  return out;
}
