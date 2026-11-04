/**
 * CONTRACT TEST (Sprint 3): the REAL GitHub scorer, verifier and pinger (with fake GitHub and fake HTTP) and the
 * post-unlock buttons, against the REAL migrations, through supabase-js -> PostgREST -> Postgres.
 * It proves every RPC name, argument, return shape and permission those modules depend on.
 *
 * Run with:  npm run test:contract
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RECRUITER_CONSENTS, TALENT_CONSENTS } from "@/lib/constants";
import { addProject, createRecruiterProfile, createTalentProfile, openWhatsapp, recordMissingConsents, reportGhosting, submitLeadFeedback, syncPhoneVerification } from "@/lib/rpc";
import { friendlyMessage } from "@/lib/errors";
import { CONTAINER, clientFor, confirmPhone, sql, startProxy } from "@/lib/testing/contract-harness";
import { buildCreateRecruiterArgs } from "@/lib/validation/recruiter";
import { buildCreateTalentArgs } from "@/lib/validation/talent";
import { databaseGithubStore, runGithubScoring, type GithubApi } from "@/lib/workers/github";
import type { GuardedResponse } from "@/lib/workers/net/fetch";
import { databasePingStore, runPings } from "@/lib/workers/ping";
import { databaseVerifyStore, runVerification } from "@/lib/workers/verify";

let proxy: { url: string; close: () => void };
let admin: SupabaseClient;
let talent: SupabaseClient;
let recruiter: SupabaseClient;
let talentUser = "";
let talentId = "";
let recruiterId = "";
const ghUser = `dev-${randomUUID().slice(0, 6)}`;

const fileResponse = (body: string, status = 200): GuardedResponse => ({ status, headers: {}, body: Buffer.from(body), truncated: false, latencyMs: 42, finalUrl: "", redirects: 0 });

beforeAll(async () => {
  if (!CONTAINER) return;
  proxy = await startProxy();
  admin = clientFor(proxy.url, { service: true });

  // --- a talent (developer with a GitHub login) ---
  talentUser = randomUUID();
  sql(`insert into auth.users(id,email) values ('${talentUser}','t-${talentUser.slice(0, 8)}@example.com')`);
  sql(`insert into auth.identities(user_id,provider,identity_data) values ('${talentUser}','github','{"sub":"gh-${talentUser.slice(0, 8)}","user_name":"${ghUser}"}')`);
  talent = clientFor(proxy.url, { userId: talentUser });
  await recordMissingConsents(talent, TALENT_CONSENTS);
  talentId = await createTalentProfile(
    talent,
    buildCreateTalentArgs({
      role: "developer", fullName: "Rahul Sharma", email: "rahul@example.com", state: "Assam", city: "Guwahati", nativeLanguage: "Assamese",
      secondaryLanguages: ["English"], skills: ["flutter", "kotlin"], hourlyRate: "600", whatsapp: "9811100077", portfolioUrl: "",
    }),
  );
  confirmPhone(talentUser, "+919811100077");
  await syncPhoneVerification(talent);
  sql(`update talent_public set proof_score = 50 where id='${talentId}'`); // listed + Standard tier

  // --- a recruiter with a free preview ---
  const rid = randomUUID();
  sql(`insert into auth.users(id,email) values ('${rid}','r-${rid.slice(0, 8)}@example.com')`);
  recruiter = clientFor(proxy.url, { userId: rid });
  confirmPhone(rid, "+919700000077");
  await recordMissingConsents(recruiter, RECRUITER_CONSENTS);
  recruiterId = await createRecruiterProfile(recruiter, buildCreateRecruiterArgs({ companyName: "Sprint3 Co", gstin: "" }));
});
afterAll(() => proxy?.close());

describe.skipIf(!CONTAINER)("Sprint 3 modules vs the real database", () => {
  describe("worker functions can only be driven with the service role", () => {
    it.each([
      ["record_ping", { p_project: randomUUID(), p_http_status: 200, p_latency_ms: 1, p_is_up: true }],
      ["mark_project_verified", { p_project: randomUUID(), p_method: "well_known_file" }],
      ["github_scoring_queue", { p_limit: 5 }],
    ])("a signed-in user cannot call %s", async (fn, args) => {
      const r = await talent.rpc(fn, args);
      expect(r.error?.code).toBe("42501"); // insufficient_privilege
    });
    it("nor read the dormant Telegram outbox table", async () => {
      expect((await talent.from("telegram_outbox").select("*")).error?.code).toBe("42501");
    });
  });

  describe("post-unlock buttons (the rpc wrappers behind My leads)", () => {
    it("the free preview unlocks the talent (the other tests in this block need an unlock)", async () => {
      const r = await recruiter.rpc("unlock_talent_contact", { p_talent_id: talentId });
      expect(r.error).toBeNull();
    });
    it("rating before opening WhatsApp is refused with a plain-language message", async () => {
      const e = await submitLeadFeedback(recruiter, talentId, "responsive").catch((x) => x);
      expect(friendlyMessage(e)).toMatch(/Open WhatsApp first/);
    });
    it("Open WhatsApp records the click and returns the wa.me link (no number leaks anywhere else)", async () => {
      expect(await openWhatsapp(recruiter, talentId)).toBe("https://wa.me/919811100077");
      expect(sql(`select has_clicked_whatsapp from lead_unlocks where talent_id='${talentId}'`)).toBe("t");
    });
    it("👍 is accepted once; a second rating gets a friendly 'already rated'", async () => {
      await submitLeadFeedback(recruiter, talentId, "responsive");
      expect(sql(`select rating from lead_feedback where talent_id='${talentId}'`)).toBe("responsive");
      const e = await submitLeadFeedback(recruiter, talentId, "not_fit").catch((x) => x);
      expect(friendlyMessage(e)).toMatch(/already rated/);
    });
    it("a free preview can never be reported", async () => {
      const e = await reportGhosting(recruiter, talentId, "").catch((x) => x);
      expect(friendlyMessage(e)).toMatch(/Free previews can't be reported/);
    });
  });

  describe("GitHub scorer", () => {
    it("scores the developer from (fake) GitHub data through set_work_depth_from_commits", async () => {
      const day = (n: number, h = 10) => new Date(Date.now() - n * 86_400_000 + h * 3_600_000 - 12 * 3_600_000).toISOString();
      const commits = Array.from({ length: 45 }, (_, i) => ({ sha: `sha${i}`, commit: { author: { date: day(1 + (i % 20), i % 10) } } }));
      const seen: string[] = [];
      const gh: GithubApi = {
        async get<T>(path: string) {
          seen.push(path);
          if (path.startsWith(`/users/${ghUser}/repos`)) return { status: 200, data: [{ name: "app", fork: false, pushed_at: day(1) }] as T };
          if (/\/commits\/sha\d+$/.test(path)) return { status: 200, data: { files: [{ filename: "src/app.ts" }] } as T };
          if (path.includes(`/repos/${ghUser}/app/commits?`)) return { status: 200, data: commits as T };
          return { status: 404, data: null };
        },
      };
      const s = await runGithubScoring(databaseGithubStore(admin), gh, { limit: 50 });
      expect(s.scored).toBeGreaterThanOrEqual(1);
      expect(seen.some((p) => p.startsWith(`/users/${ghUser}/repos`))).toBe(true);
      expect(sql(`select (score_breakdown->>'commits_90d')||' '||(score_breakdown->>'work_depth') from talent_public where id='${talentId}'`)).toBe("45 31");
      expect(sql(`select score_breakdown->>'github_scored_at' is not null from talent_public where id='${talentId}'`)).toBe("t");
    });
    it("does not queue them again for ~20 hours, and never touches seed profiles", async () => {
      const q = await admin.rpc("github_scoring_queue", { p_limit: 100 });
      expect(q.error).toBeNull();
      const rows = q.data as { talent_id: string }[];
      expect(rows.some((r) => r.talent_id === talentId)).toBe(false);
      expect(rows.some((r) => r.talent_id.startsWith("00000000-0000-4000-8000-"))).toBe(false);
    });
  });

  describe("ownership verification and pings", () => {
    let projectId = "";
    let token = "";
    it("an unverified project is NOT pinged and a missing proof file leaves it pending", async () => {
      const added = await addProject(talent, "Logistics app", "https://rahul-shop.example.in");
      token = added.verification_token;
      projectId = sql(`select id from projects where talent_id='${talentId}'`);
      sql(`update projects set next_ping_at = now() + interval '1 day' where id <> '${projectId}'`); // keep the 15 seed sites out of this test
      const v = await runVerification(databaseVerifyStore(admin), { get: async () => ({ status: 404, data: null }) as never }, { get: async () => fileResponse("", 404) });
      expect(v.pending).toBeGreaterThanOrEqual(1);
      const p = await runPings(databasePingStore(admin), { get: async () => fileResponse("<title>x</title>"), pauseMs: 0 });
      expect(p.claimed).toBe(0);
      expect(sql(`select count(*) from ping_results where project_id='${projectId}'`)).toBe("0");
    });
    it("verification is retried at most hourly", async () => {
      const v = await runVerification(databaseVerifyStore(admin), { get: async () => ({ status: 404, data: null }) as never }, { get: async () => fileResponse(`devmap-verify=${token}`) });
      expect(v.claimed).toBe(0);
      sql(`update projects set verify_attempted_at = now() - interval '2 hours' where id='${projectId}'`);
    });
    it("the proof file makes it verified (direct proof = 20 verification points)", async () => {
      let asked = "";
      const v = await runVerification(databaseVerifyStore(admin), { get: async () => ({ status: 404, data: null }) as never }, {
        get: async (u) => {
          asked = u;
          return fileResponse(`devmap-verify=${token}\n`);
        },
      });
      expect(asked).toBe("https://rahul-shop.example.in/devmap-verify.txt");
      expect(v.verified).toBeGreaterThanOrEqual(1);
      expect(sql(`select verification_method||' '||is_ownership_verified from projects where id='${projectId}'`)).toBe("well_known_file true");
      expect(sql(`select score_breakdown->>'verification' from talent_public where id='${talentId}'`)).toBe("20");
    });
    it("now it is pinged: result stored, uptime recomputed, next ping scheduled 3-9h out", async () => {
      const p = await runPings(databasePingStore(admin), { get: async () => fileResponse("<title>Rahul Shop</title>"), pauseMs: 0 });
      expect(p).toMatchObject({ claimed: 1, up: 1 });
      expect(sql(`select samples_30d||' '||uptime_30d||' '||is_up from projects where id='${projectId}'`)).toBe("1 100.00 true");
      expect(sql(`select next_ping_at between now()+interval '2 hours 59 minutes' and now()+interval '9 hours 1 minute' from projects where id='${projectId}'`)).toBe("t");
      expect(sql(`select count(*) from ping_results where project_id='${projectId}'`)).toBe("1");
    });
    it("a starter-template page is recorded as down", async () => {
      sql(`update projects set next_ping_at = null where id='${projectId}'`);
      expect((await runPings(databasePingStore(admin), { get: async () => fileResponse("<title>Create Next App</title>"), pauseMs: 0 })).claimed).toBe(1);
      expect(sql(`select error||' '||is_up from ping_results where project_id='${projectId}' order by checked_at desc limit 1`)).toBe("default_template false");
    });
    it("not due yet -> not pinged again", async () => {
      const p = await runPings(databasePingStore(admin), { get: async () => fileResponse("<title>x</title>"), pauseMs: 0 });
      expect(p.claimed).toBe(0);
      expect(sql(`select count(*) from ping_results where project_id='${projectId}'`)).toBe("2");
    });
  });

  it("(sanity) the recruiter row used above exists", () => {
    expect(recruiterId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
