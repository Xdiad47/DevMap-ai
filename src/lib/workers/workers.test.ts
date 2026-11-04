import { describe, expect, it, vi } from "vitest";
import { verifyCronAuth } from "./auth";
import {
  applyStructuralRules, countNonTrivial, createGithubApi, DAILY_CAP, DETAIL_BUDGET, GithubNotFound, isTrivialCommit, RateLimitError,
  runGithubScoring, scoreDeveloper, type Commit, type GithubApi, type GithubStore,
} from "./github";
import type { GuardedResponse } from "./net/fetch";
import { SsrfError } from "./net/guard";
import { attempt, describeError, pingProject, runPings, type PingStore } from "./ping";
import { extractTitle, isDefaultTemplate } from "./templates";
import { checkGithubHomepage, checkWellKnownFile, runVerification, sameSite, type VerifyRow, type VerifyStore } from "./verify";

describe("cron auth", () => {
  const S = "a_long_enough_cron_secret";
  it("accepts only the exact bearer secret", () => {
    expect(verifyCronAuth(`Bearer ${S}`, S)).toBe(true);
    for (const bad of [null, "", S, `bearer ${S}`, `Bearer ${S}x`, `Bearer ${S.slice(1)}`, "Bearer "]) expect(verifyCronAuth(bad, S)).toBe(false);
  });
  it("an unset or short secret never means 'open'", () => {
    expect(verifyCronAuth("Bearer ", undefined)).toBe(false);
    expect(verifyCronAuth("Bearer abc", "abc")).toBe(false);
    expect(verifyCronAuth("Bearer undefined", undefined)).toBe(false);
  });
});

describe("template detection", () => {
  it.each(["<title>Create Next App</title>", "<TITLE>Vite + React</TITLE>", "<title>\n  Welcome to nginx!\n</title>", "<head><title>React App</title></head>"])("flags %s", (h) => expect(isDefaultTemplate(h)).toBe(true));
  it.each(["<title>Priya Bora - Portfolio</title>", "<title>Create Next App Studio</title>", "<p>no title</p>", ""])("lets %s through", (h) => expect(isDefaultTemplate(h)).toBe(false));
  it("only reads the head of the page", () => {
    expect(extractTitle("x".repeat(70_000) + "<title>Vite + React</title>")).toBeNull();
  });
});

describe("ping logic", () => {
  const ok = (status: number, body = "<title>Real</title>"): GuardedResponse => ({ status, headers: {}, body: Buffer.from(body), truncated: false, latencyMs: 120, finalUrl: "https://x.dev/", redirects: 0 });
  it("2xx = up", async () => expect(await attempt("https://x.dev", async () => ok(200))).toEqual({ isUp: true, httpStatus: 200, latencyMs: 120, error: null }));
  it("5xx / 4xx = down with the status", async () => {
    expect(await attempt("https://x.dev", async () => ok(503))).toMatchObject({ isUp: false, httpStatus: 503, error: "http_503" });
    expect(await attempt("https://x.dev", async () => ok(404))).toMatchObject({ isUp: false, error: "http_404" });
  });
  it("a 200 that is a starter template is NOT up", async () => {
    expect(await attempt("https://x.dev", async () => ok(200, "<title>Create Next App</title>"))).toMatchObject({ isUp: false, error: "default_template" });
  });
  it("either of two tries is enough (one blip is never downtime)", async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(ok(200));
    expect(await pingProject("https://x.dev", get, undefined, 0)).toMatchObject({ isUp: true });
    expect(get).toHaveBeenCalledTimes(2);
  });
  it("down only when both tries fail", async () => {
    const get = vi.fn().mockRejectedValue(new Error("timeout"));
    expect(await pingProject("https://x.dev", get, undefined, 0)).toMatchObject({ isUp: false, error: "timeout" });
    expect(get).toHaveBeenCalledTimes(2);
  });
  it("an SSRF block is final: no second try, recorded as blocked", async () => {
    const get = vi.fn().mockRejectedValue(new SsrfError("private_address"));
    expect(await pingProject("https://x.dev", get, undefined, 0)).toMatchObject({ isUp: false, error: "blocked:private_address" });
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("a template is final too (retrying cannot change the page)", async () => {
    const get = vi.fn(async () => ok(200, "<title>Vite + React</title>"));
    await pingProject("https://x.dev", get, undefined, 0);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("error descriptions are short codes with no URLs or IPs", () => {
    expect(describeError(Object.assign(new Error("x"), { code: "CERT_HAS_EXPIRED" }))).toBe("tls:CERT_HAS_EXPIRED");
    expect(describeError(new Error("Hostname/IP does not match certificate's altnames"))).toBe("tls:invalid_certificate");
    expect(describeError(Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:443"), { code: "ECONNREFUSED" }))).toBe("network:ECONNREFUSED");
    expect(describeError(new Error("something odd with https://secret.internal"))).toBe("network_error");
  });
  it("runPings records every claimed project and counts outcomes", async () => {
    const recorded: string[] = [];
    const store: PingStore = {
      claim: async () => [{ project_id: "a", live_url: "https://a.dev" }, { project_id: "b", live_url: "https://b.dev" }, { project_id: "c", live_url: "https://c.dev" }],
      record: async (id) => void recorded.push(id),
    };
    const get = async (u: string) => {
      if (u.includes("b.dev")) throw new SsrfError("private_address");
      return ok(200);
    };
    const s = await runPings(store, { get, pauseMs: 0 });
    expect(s).toMatchObject({ claimed: 3, up: 2, down: 1, blocked: 1, budgetExhausted: false });
    expect(recorded.sort()).toEqual(["a", "b", "c"]);
  });
  it("stops starting new pings when the time budget is spent", async () => {
    const store: PingStore = { claim: async () => [{ project_id: "a", live_url: "https://a.dev" }], record: vi.fn(async () => {}) };
    const s = await runPings(store, { budgetMs: -1, get: async () => ok(200) });
    expect(s.budgetExhausted).toBe(true);
    expect(store.record).not.toHaveBeenCalled();
  });
});

describe("ownership verification", () => {
  const row = (over: Partial<VerifyRow> = {}): VerifyRow => ({ project_id: "p", live_url: "https://shop.dev/some/page", repo_url: "https://github.com/rahul-dev/shop", verification_token: "tok123", github_username: "rahul-dev", ...over });
  const file = (body: string, status = 200): GuardedResponse => ({ status, headers: {}, body: Buffer.from(body), truncated: false, latencyMs: 1, finalUrl: "", redirects: 0 });

  it("the well-known file must contain the exact token line, fetched from the site ROOT", async () => {
    const get = vi.fn(async () => file("hello\ndevmap-verify=tok123\n"));
    expect(await checkWellKnownFile(row(), get as never)).toBe(true);
    const [url, opts] = (get.mock.calls as unknown as [string, { maxBytes?: number }][])[0];
    expect(url).toBe("https://shop.dev/devmap-verify.txt");
    expect(opts).toMatchObject({ maxBytes: 4096 });
  });
  it.each(["devmap-verify=tok1234", "devmap-verify=TOK123", "tok123", "xdevmap-verify=tok123", ""])("rejects %j", async (body) => {
    expect(await checkWellKnownFile(row(), async () => file(body))).toBe(false);
  });
  it("rejects a 404, a network error, and a blocked host", async () => {
    expect(await checkWellKnownFile(row(), async () => file("devmap-verify=tok123", 404))).toBe(false);
    expect(await checkWellKnownFile(row(), async () => { throw new Error("timeout"); })).toBe(false);
    expect(await checkWellKnownFile(row(), async () => { throw new SsrfError("private_address"); })).toBe(false);
  });

  it("sameSite ignores case and trailing slashes but not paths", () => {
    expect(sameSite("https://Shop.dev/", "https://shop.dev")).toBe(true);
    expect(sameSite("https://shop.dev/a/", "https://shop.dev/a")).toBe(true);
    expect(sameSite("https://shop.dev/a", "https://shop.dev/b")).toBe(false);
    expect(sameSite("http://shop.dev", "https://shop.dev")).toBe(false);
    expect(sameSite("garbage", "https://shop.dev")).toBe(false);
  });
  const gh = (data: unknown, status = 200): GithubApi => ({ get: vi.fn(async () => ({ status, data })) as never });
  it("github_homepage: own repo + homepage equals the live URL", async () => {
    expect(await checkGithubHomepage(row({ live_url: "https://shop.dev" }), gh({ homepage: "https://shop.dev/", owner: { login: "Rahul-Dev" } }))).toBe(true);
  });
  it("github_homepage refuses someone else's repo, a different homepage, or no GitHub account", async () => {
    expect(await checkGithubHomepage(row({ repo_url: "https://github.com/someone-else/shop" }), gh({ homepage: "https://shop.dev/some/page", owner: { login: "someone-else" } }))).toBe(false);
    expect(await checkGithubHomepage(row(), gh({ homepage: "https://other.dev", owner: { login: "rahul-dev" } }))).toBe(false);
    expect(await checkGithubHomepage(row(), gh({ homepage: null, owner: { login: "rahul-dev" } }))).toBe(false);
    expect(await checkGithubHomepage(row({ github_username: null }), gh({}))).toBe(false);
    expect(await checkGithubHomepage(row({ repo_url: null }), gh({}))).toBe(false);
    expect(await checkGithubHomepage(row(), gh(null, 404))).toBe(false);
  });
  it("github_homepage double-checks the API's owner, in case the URL lies (renamed repo, transferred repo)", async () => {
    expect(await checkGithubHomepage(row(), gh({ homepage: "https://shop.dev/some/page", owner: { login: "new-owner" } }))).toBe(false);
  });

  it("runVerification: file first, GitHub second; reports 'taken' when another talent already holds the URL", async () => {
    const calls: [string, string][] = [];
    const store: VerifyStore = {
      claim: async () => [row({ project_id: "a" }), row({ project_id: "b" }), row({ project_id: "c" })],
      markVerified: async (id, method) => {
        calls.push([id, method]);
        return id === "c" ? "url_already_verified" : "verified";
      },
    };
    const get = async (u: string) => file(u.includes("shop.dev") ? "devmap-verify=tok123" : "");
    const api = gh({ homepage: "https://x" , owner: { login: "rahul-dev" } });
    const s = await runVerification(store, api, { get });
    expect(s).toEqual({ claimed: 3, verified: 2, taken: 1, pending: 0 });
    expect(calls.every(([, m]) => m === "well_known_file")).toBe(true);
    expect((api.get as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled(); // never spent GitHub quota
  });
  it("runVerification leaves unproven projects pending", async () => {
    const store: VerifyStore = { claim: async () => [row()], markVerified: vi.fn(async () => "verified" as const) };
    const s = await runVerification(store, gh({ homepage: null, owner: { login: "rahul-dev" } }), { get: async () => file("", 404) });
    expect(s.pending).toBe(1);
    expect(store.markVerified).not.toHaveBeenCalled();
  });
});

// ------------------------------- GitHub scorer -------------------------------
const commit = (repo: string, iso: string, sha = `${repo}-${iso}`): Commit => ({ sha, repo, at: new Date(iso).toISOString() });

describe("isTrivialCommit", () => {
  it.each([[["package-lock.json"]], [["README.md"]], [["docs/README.md", "yarn.lock"]], [["pnpm-lock.yaml", "go.sum"]], [["web/Cargo.lock"]], [[]]])("%j is trivial", (f) => expect(isTrivialCommit(f)).toBe(true));
  it.each([[["src/app.ts"]], [["README.md", "src/index.js"]], [["readme-generator.js"]], [["package.json"]], [["docs/guide.md"]]])("%j is real work", (f) => expect(isTrivialCommit(f)).toBe(false));
});

describe("applyStructuralRules", () => {
  it("drops repos active on only one day", () => {
    const kept = applyStructuralRules([
      commit("burst", "2026-10-01T10:00:00Z", "b1"), commit("burst", "2026-10-01T11:00:00Z", "b2"), commit("burst", "2026-10-01T12:00:00Z", "b3"),
      commit("steady", "2026-10-01T10:00:00Z", "s1"), commit("steady", "2026-10-03T10:00:00Z", "s2"),
    ]);
    expect(kept.map((c) => c.sha).sort()).toEqual(["s1", "s2"]);
  });
  it(`caps at ${DAILY_CAP} commits per day across all repos`, () => {
    const day1 = Array.from({ length: 40 }, (_, i) => commit("a", `2026-10-01T${String(i % 24).padStart(2, "0")}:${String(i).padStart(2, "0")}:00Z`, `d1-${i}`));
    const day2 = [commit("a", "2026-10-02T09:00:00Z", "d2-0")];
    const kept = applyStructuralRules([...day1, ...day2]);
    expect(kept.filter((c) => c.at.startsWith("2026-10-01"))).toHaveLength(DAILY_CAP);
    expect(kept.filter((c) => c.at.startsWith("2026-10-02"))).toHaveLength(1);
  });
  it("is deterministic regardless of input order", () => {
    const cs = Array.from({ length: 30 }, (_, i) => commit("a", `2026-10-0${1 + (i % 2)}T${String(i % 24).padStart(2, "0")}:00:00Z`, `c${i}`));
    expect(applyStructuralRules(cs).map((c) => c.sha)).toEqual(applyStructuralRules([...cs].reverse()).map((c) => c.sha));
  });
});

describe("countNonTrivial", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => commit("r", "2026-10-01T00:00:00Z", `c${i}`));
  it("small sets are checked exactly", async () => {
    const trivial = new Set(["c1", "c3"]);
    const r = await countNonTrivial(many(5), async (c) => (trivial.has(c.sha) ? ["README.md"] : ["src/a.ts"]));
    expect(r).toEqual({ counted: 3, sampled: 5 });
  });
  it("large sets are sampled with a fixed budget and the ratio is applied to the whole", async () => {
    const calls = vi.fn(async () => ["README.md"]);   // account padded with README edits
    const r = await countNonTrivial(many(500), calls);
    expect(calls).toHaveBeenCalledTimes(DETAIL_BUDGET);
    expect(r.counted).toBe(0);
  });
  it("a genuine account keeps (nearly) everything", async () => {
    expect((await countNonTrivial(many(500), async () => ["src/x.ts"])).counted).toBe(500);
  });
  it("half-padded accounts lose about half", async () => {
    let i = 0;
    const r = await countNonTrivial(many(400), async () => (i++ % 2 === 0 ? ["yarn.lock"] : ["src/x.ts"]));
    expect(r.counted).toBe(200);
  });
  it("nothing to check -> zero, no API calls", async () => {
    const f = vi.fn();
    expect(await countNonTrivial([], f)).toEqual({ counted: 0, sampled: 0 });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("scoreDeveloper (fake GitHub)", () => {
  const NOW = new Date("2026-11-01T00:00:00Z");
  function fakeGithub(spec: { repos: unknown[] | 404 | 500; commits?: Record<string, unknown[]>; files?: Record<string, string[]> }) {
    const paths: string[] = [];
    const api: GithubApi = {
      async get<T>(path: string) {
        paths.push(path);
        if (path.includes("/repos?") || path.endsWith("per_page=100") && path.startsWith("/users/")) {
          if (spec.repos === 404) return { status: 404, data: null };
          if (spec.repos === 500) return { status: 500, data: null };
          return { status: 200, data: spec.repos as T };
        }
        const m = /\/repos\/[^/]+\/([^/]+)\/commits\/([^?]+)$/.exec(path);
        if (m) return { status: 200, data: { files: (spec.files?.[m[2]] ?? ["src/a.ts"]).map((filename) => ({ filename })) } as T };
        const c = /\/repos\/[^/]+\/([^/]+)\/commits\?/.exec(path);
        if (c) return { status: 200, data: (spec.commits?.[c[1]] ?? []) as T };
        return { status: 404, data: null };
      },
    };
    return { api, paths };
  }
  const ci = (sha: string, iso: string) => ({ sha, commit: { author: { date: iso } } });
  const repo = (name: string, extra: object = {}) => ({ name, fork: false, pushed_at: "2026-10-30T00:00:00Z", ...extra });

  it("counts authored commits in owned, non-fork, recently-pushed repos", async () => {
    const { api, paths } = fakeGithub({
      repos: [repo("app"), repo("forked", { fork: true }), repo("stale", { pushed_at: "2025-01-01T00:00:00Z" }), repo("off", { disabled: true })],
      commits: { app: [ci("1", "2026-10-30T10:00:00Z"), ci("2", "2026-10-20T10:00:00Z"), ci("3", "2026-10-10T10:00:00Z")], forked: [ci("9", "2026-10-30T10:00:00Z")] },
    });
    const s = await scoreDeveloper(api, "rahul-dev", NOW);
    expect(s.commits90d).toBe(3);
    expect(s.lastCommitAt).toBe("2026-10-30T10:00:00.000Z");
    expect(paths.some((p) => p.includes("/forked/"))).toBe(false);
    expect(paths.some((p) => p.includes("/stale/"))).toBe(false);
    expect(paths.find((p) => p.includes("/app/commits?"))).toContain("author=rahul-dev"); // author filter = "linked to the account"
    expect(s.meta).toMatchObject({ github_repos_scanned: 1, github_commits_seen: 3 });
  });
  it("ignores commits outside the 90-day window and future-dated ones", async () => {
    const { api } = fakeGithub({
      repos: [repo("app")],
      commits: { app: [ci("1", "2026-10-30T10:00:00Z"), ci("2", "2026-10-29T10:00:00Z"), ci("old", "2026-06-01T10:00:00Z"), ci("future", "2027-01-01T10:00:00Z")] },
    });
    expect((await scoreDeveloper(api, "x", NOW)).commits90d).toBe(2);
  });
  it("README-only commits don't count", async () => {
    const { api } = fakeGithub({
      repos: [repo("app")],
      commits: { app: [ci("1", "2026-10-30T10:00:00Z"), ci("2", "2026-10-29T10:00:00Z"), ci("3", "2026-10-28T10:00:00Z")] },
      files: { "1": ["README.md"], "2": ["src/a.ts"], "3": ["package-lock.json"] },
    });
    expect((await scoreDeveloper(api, "x", NOW)).commits90d).toBe(1);
  });
  it("a user with no qualifying repos scores zero without error", async () => {
    const s = await scoreDeveloper(fakeGithub({ repos: [] }).api, "x", NOW);
    expect(s).toMatchObject({ commits90d: 0, lastCommitAt: null });
  });
  it("404 -> GithubNotFound; other errors -> thrown", async () => {
    await expect(scoreDeveloper(fakeGithub({ repos: 404 }).api, "x", NOW)).rejects.toBeInstanceOf(GithubNotFound);
    await expect(scoreDeveloper(fakeGithub({ repos: 500 }).api, "x", NOW)).rejects.toThrow("github_500");
  });
});

describe("runGithubScoring", () => {
  const mk = (rows: { talent_id: string; github_username: string }[]) => {
    const calls = { scored: [] as string[], failures: [] as [string, string][] };
    const store: GithubStore = {
      queue: async () => rows,
      setWorkDepth: async (id, s) => void calls.scored.push(`${id}:${s.commits90d}`),
      recordFailure: async (id, r) => void calls.failures.push([id, r]),
    };
    return { store, calls };
  };
  const repos404: GithubApi = { get: async () => ({ status: 404, data: null }) as never };
  it("records a failure (and keeps the old score) for a vanished GitHub account", async () => {
    const { store, calls } = mk([{ talent_id: "t1", github_username: "gone" }]);
    expect(await runGithubScoring(store, repos404)).toMatchObject({ queued: 1, scored: 0, notFound: 1 });
    expect(calls.failures).toEqual([["t1", "not_found"]]);
  });
  it("stops at the rate limit WITHOUT stamping anyone, so they stay first in line", async () => {
    const { store, calls } = mk([{ talent_id: "t1", github_username: "a" }, { talent_id: "t2", github_username: "b" }]);
    const limited: GithubApi = { get: async () => { throw new RateLimitError(); } };
    expect(await runGithubScoring(store, limited)).toMatchObject({ rateLimited: true, scored: 0, failed: 0 });
    expect(calls.failures).toHaveLength(0);
  });
  it("a generic API error is recorded and the run continues", async () => {
    const { store, calls } = mk([{ talent_id: "t1", github_username: "a" }, { talent_id: "t2", github_username: "b" }]);
    let n = 0;
    const flaky: GithubApi = { get: async () => (n++ === 0 ? { status: 500, data: null } : { status: 200, data: [] }) as never };
    expect(await runGithubScoring(store, flaky)).toMatchObject({ scored: 1, failed: 1 });
    expect(calls.failures).toEqual([["t1", "api_error"]]);
    expect(calls.scored).toEqual(["t2:0"]);
  });
});

describe("createGithubApi", () => {
  it("sends the token only when configured, and maps rate limiting", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
    await expect(createGithubApi("tok", f as never).get("/x")).rejects.toBeInstanceOf(RateLimitError);
    expect(((f.mock.calls[0] as unknown) as [string, RequestInit])[1].headers).toMatchObject({ authorization: "Bearer tok" });
    const g = vi.fn(async () => new Response("[]", { status: 200 }));
    await createGithubApi(undefined, g as never).get("/x");
    expect(JSON.stringify(((g.mock.calls[0] as unknown) as [string, RequestInit])[1].headers)).not.toContain("authorization");
  });
  it("404 is a result, not an exception", async () => {
    expect(await createGithubApi(undefined, (async () => new Response("", { status: 404 })) as never).get("/x")).toEqual({ status: 404, data: null });
  });
});
