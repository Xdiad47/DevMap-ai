/**
 * CONTRACT TEST: the app's real code (src/lib/rpc.ts, form builders, shared column lists) against the
 * real migration, through supabase-js -> PostgREST -> Postgres, using signed JWTs.
 *
 * What it proves: every RPC name, argument name, column name and error code the app relies on exists and
 * behaves as the app assumes. Type-checking can't prove this because the Supabase client is untyped.
 *
 * What it does NOT cover: Supabase Auth itself (OTP sending, OAuth). "Auth confirmed this phone" is
 * simulated with an SQL UPDATE on auth.users, exactly what Auth would do.
 *
 * Run it with:  npm run test:contract   (needs Docker; see scripts/contract-test.sh)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RECRUITER_CONSENTS, TALENT_CONSENTS, POLICY_VERSION } from "@/lib/constants";
import { AppError, isProfileExists } from "@/lib/errors";
import { maskName } from "@/lib/names";
import {
  CONSENT_COLUMNS,
  LEDGER_COLUMNS,
  PROJECT_COLUMNS,
  RECRUITER_COLUMNS,
  SKILL_COLUMNS,
  TALENT_COLUMNS,
  TALENT_PRIVATE_COLUMNS,
} from "@/lib/queries";
import {
  addProject,
  createRecruiterProfile,
  createTalentProfile,
  recordMissingConsents,
  syncPhoneVerification,
} from "@/lib/rpc";
import { buildCreateRecruiterArgs } from "@/lib/validation/recruiter";
import { buildCreateTalentArgs, type TalentFormValues } from "@/lib/validation/talent";

const CONTAINER = process.env.CT_CONTAINER;
const REST_URL = process.env.CT_POSTGREST_URL;
const SECRET = process.env.CT_JWT_SECRET ?? "";
const DB = process.env.CT_DB ?? "devmap_test";
const BROWSER_IP = "203.0.113.9";

const sql = (query: string) =>
  execFileSync("docker", ["exec", "-i", CONTAINER!, "psql", "-U", "postgres", "-d", DB, "-At", "-q", "-c", query], {
    encoding: "utf8",
  }).trim();

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(claims: Record<string, unknown>) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

let proxy: http.Server;
let apiUrl = "";

/** supabase-js talks to `${url}/rest/v1/...`; bare PostgREST serves from `/`. This strips the prefix. */
beforeAll(async () => {
  if (!CONTAINER) return;
  proxy = http.createServer((req, res) => {
    const upstream = http.request(
      REST_URL! + req.url!.replace(/^\/rest\/v1/, ""),
      { method: req.method, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 500, up.headers);
        up.pipe(res);
      },
    );
    req.pipe(upstream);
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  apiUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
});
afterAll(() => proxy?.close());

function clientFor(userId: string | null): SupabaseClient {
  const anonKey = jwt({ role: "anon" });
  return createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        ...(userId ? { Authorization: `Bearer ${jwt({ sub: userId, role: "authenticated" })}` } : {}),
        "x-forwarded-for": BROWSER_IP,
        "user-agent": "contract-test",
      },
    },
  });
}

function newUser(opts: { github?: boolean } = {}): string {
  const id = randomUUID();
  sql(`insert into auth.users(id,email) values ('${id}','${id.slice(0, 8)}@example.com')`);
  if (opts.github) {
    sql(`insert into auth.identities(user_id,provider,identity_data) values ('${id}','github','{"sub":"gh-${id.slice(0, 8)}","user_name":"dev-${id.slice(0, 6)}"}')`);
  }
  return id;
}

const form = (over: Partial<TalentFormValues> = {}): TalentFormValues => ({
  role: "developer",
  fullName: "Rahul Sharma",
  email: "rahul@example.com",
  state: "Assam",
  city: "Guwahati",
  nativeLanguage: "Assamese",
  secondaryLanguages: ["English"],
  skills: ["flutter", "kotlin"],
  hourlyRate: "600",
  whatsapp: "9876500001",
  portfolioUrl: "https://rahul.dev",
  ...over,
});

describe.skipIf(!CONTAINER)("app code vs the real migration", () => {
  it("anonymous visitors can read the skills catalogue but nothing private", async () => {
    const anon = clientFor(null);
    const skills = await anon.from("skills").select(SKILL_COLUMNS);
    expect(skills.error).toBeNull();
    expect(skills.data).toHaveLength(19);

    const vault = await anon.from("talent_private").select("full_name");
    expect(vault.error).not.toBeNull(); // permission denied
    const ledger = await anon.from("credits_ledger").select("*");
    expect(ledger.error).not.toBeNull();
  });

  describe("talent onboarding", () => {
    let uid = "";
    let sb: SupabaseClient;
    let talentId = "";
    beforeAll(() => {
      uid = newUser({ github: true });
      sb = clientFor(uid);
    });

    it("records the three consents once, with the BROWSER's IP address", async () => {
      await recordMissingConsents(sb, TALENT_CONSENTS);
      await recordMissingConsents(sb, TALENT_CONSENTS); // second run must add nothing
      const rows = await sb.from("consents").select(CONSENT_COLUMNS);
      expect(rows.error).toBeNull();
      expect(rows.data).toHaveLength(3);
      expect(sql(`select host(ip_address) from consents where user_id='${uid}' limit 1`)).toBe(BROWSER_IP);
      expect(sql(`select policy_version from consents where user_id='${uid}' limit 1`)).toBe(POLICY_VERSION);
    });

    it("creates the profile with exactly the arguments the form builds", async () => {
      talentId = await createTalentProfile(sb, buildCreateTalentArgs(form()));
      expect(talentId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("the server computes the same masked name as the form preview", async () => {
      const own = await sb.from("talent_public").select(TALENT_COLUMNS).eq("user_id", uid).maybeSingle();
      expect(own.error).toBeNull();
      expect(own.data?.masked_name).toBe(maskName("Rahul Sharma"));
      expect(own.data?.is_listed).toBe(false); // phone not verified yet
      expect(own.data?.state_rank).toBeNull();
    });

    it("stores rupees as paise, coordinates as city centroid, WhatsApp as E.164", () => {
      expect(sql(`select hourly_rate_paise from talent_public where id='${talentId}'`)).toBe("60000");
      expect(sql(`select latitude from talent_public where id='${talentId}'`)).toBe("26.144500");
      expect(sql(`select whatsapp_number||'|'||phone_e164 from talent_private where talent_id='${talentId}'`)).toBe("+919876500001|+919876500001");
      expect(sql(`select portfolio_links::text from talent_private where talent_id='${talentId}'`)).toBe('["https://rahul.dev"]');
    });

    it("the owner can read their private row with the dashboard's column list", async () => {
      const priv = await sb.from("talent_private").select(TALENT_PRIVATE_COLUMNS).maybeSingle();
      expect(priv.error).toBeNull();
      expect(priv.data?.is_phone_verified).toBe(true); // beta: self-declared number, no OTP
    });

    it("a second submit is recognised as 'already exists', which onboarding treats as success", async () => {
      const err = await createTalentProfile(sb, buildCreateTalentArgs(form())).catch((e) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(isProfileExists(err)).toBe(true);
    });

    it("beta: the profile is ready without any phone step, and the sync call is harmless to repeat", async () => {
      expect((await syncPhoneVerification(sb)).talent_verified).toBe(true);
      expect((await syncPhoneVerification(sb)).talent_verified).toBe(true);
    });

    it("listing gate: no score yet and not reviewed -> still invisible to anon", async () => {
      const anon = clientFor(null);
      const r = await anon.from("talent_public").select("id").eq("id", talentId);
      expect(r.data).toHaveLength(0);
    });

    it("once scored, anon sees the masked card and still no contact data", async () => {
      sql(`update talent_public set proof_score=50 where id='${talentId}'`);
      const anon = clientFor(null);
      const card = await anon.from("talent_public").select("masked_name, city, hourly_rate_paise").eq("id", talentId);
      expect(card.data).toEqual([{ masked_name: "Rahul S.", city: "Guwahati", hourly_rate_paise: 60000 }]);
      expect((await anon.from("talent_private").select("whatsapp_number")).error).not.toBeNull();
      const dash = await sb.from("talent_public").select(TALENT_COLUMNS).eq("user_id", uid).single();
      expect(dash.data?.is_listed).toBe(true);
    });

    it("projects: valid URL returns verification instructions; bad URLs get friendly errors", async () => {
      const added = await addProject(sb, "Logistics Android app", "https://rahul-app.example.in");
      expect(added.verify_file_path).toBe("/devmap-verify.txt");
      expect(added.verify_file_content).toBe(`devmap-verify=${added.verification_token}`);

      await expect(addProject(sb, "Insecure", "http://plain.example.in")).rejects.toThrow(/https/);
      await expect(addProject(sb, "With port", "https://127.0.0.1:8080/x")).rejects.toThrow(/https/);
      await expect(addProject(sb, "Logistics Android app", "https://rahul-app.example.in")).rejects.toThrow(/already added/);

      const list = await sb.from("projects").select(PROJECT_COLUMNS);
      expect(list.error).toBeNull();
      expect(list.data).toHaveLength(1);
      expect(list.data![0].is_ownership_verified).toBe(false);
    });

    it("a talent cannot see or write another user's data or money tables", async () => {
      expect((await sb.from("credits_ledger").select(LEDGER_COLUMNS)).data).toHaveLength(0);
      const forged = await sb.from("lead_unlocks").insert({ recruiter_id: randomUUID(), talent_id: talentId, tier_at_unlock: "standard", credits_deducted: 0, talent_online_at_unlock: true });
      expect(forged.error).not.toBeNull();
      const edit = await sb.from("talent_public").update({ proof_score: 100 }).eq("user_id", uid);
      expect(edit.error).not.toBeNull(); // column not granted
    });
  });

  describe("talent guard rails the UI can't be trusted with", () => {
    it("a developer without a GitHub identity is refused, in plain language", async () => {
      const uid = newUser({ github: false });
      const sb = clientFor(uid);
      await recordMissingConsents(sb, TALENT_CONSENTS);
      const err = await createTalentProfile(sb, buildCreateTalentArgs(form({ whatsapp: "9876500002" }))).catch((e) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).message).toMatch(/connect a GitHub/i);
    });

    it("a designer does not need GitHub", async () => {
      const uid = newUser({ github: false });
      const sb = clientFor(uid);
      await recordMissingConsents(sb, TALENT_CONSENTS);
      const id = await createTalentProfile(sb, buildCreateTalentArgs(form({ role: "designer", skills: ["figma"], whatsapp: "9876500003", fullName: "Anita Das" })));
      expect(id).toBeTruthy();
    });

    it("profile creation without consents is refused", async () => {
      const uid = newUser({ github: false });
      const sb = clientFor(uid);
      const err = await createTalentProfile(sb, buildCreateTalentArgs(form({ role: "designer", skills: ["figma"], whatsapp: "9876500004" }))).catch((e) => e);
      expect((err as AppError).message).toMatch(/consents/i);
    });

    it("the Rs 300/hr floor holds even if the form is bypassed", async () => {
      const uid = newUser({ github: false });
      const sb = clientFor(uid);
      await recordMissingConsents(sb, TALENT_CONSENTS);
      const args = { ...buildCreateTalentArgs(form({ role: "designer", skills: ["figma"], whatsapp: "9876500005" })), p_hourly_rate_paise: 29000 };
      const err = await createTalentProfile(sb, args).catch((e) => e);
      expect((err as AppError).message).toMatch(/₹300/);
    });

    it("the same mobile number can't be registered twice", async () => {
      const uid = newUser({ github: false });
      const sb = clientFor(uid);
      await recordMissingConsents(sb, TALENT_CONSENTS);
      const err = await createTalentProfile(sb, buildCreateTalentArgs(form({ role: "designer", skills: ["figma"], whatsapp: "9876500001" }))).catch((e) => e); // used by the first test above
      expect((err as AppError).message).toMatch(/already registered/i);
    });
  });

  describe("recruiter onboarding", () => {
    let uid = "";
    let sb: SupabaseClient;
    beforeAll(() => {
      uid = newUser();
      sb = clientFor(uid);
    });

    it("refuses to create the account before the terms are accepted", async () => {
      const err = await createRecruiterProfile(sb, buildCreateRecruiterArgs({ companyName: "Acme", gstin: "" })).catch((e) => e);
      expect((err as AppError).message).toMatch(/consents/i);
    });

    it("creates the account (no phone step in the beta), and the free preview lands in the ledger", async () => {
      await recordMissingConsents(sb, RECRUITER_CONSENTS);
      const id = await createRecruiterProfile(sb, buildCreateRecruiterArgs({ companyName: "Acme Pvt Ltd", gstin: "18ABCDE1234F1Z5" }));
      expect(id).toBeTruthy();

      // This is the exact check RecruiterOnboardingForm performs.
      const ledger = await sb.from("credits_ledger").select("reason").eq("reason", "trial_grant");
      expect(ledger.error).toBeNull();
      expect(ledger.data).toHaveLength(1);

      const me = await sb.from("recruiters").select(RECRUITER_COLUMNS).eq("user_id", uid).maybeSingle();
      expect(me.data).toMatchObject({ company_name: "Acme Pvt Ltd", is_phone_verified: true, credits_balance: 0, trial_unlocks_remaining: 1 });

      const rows = await sb.from("credits_ledger").select(LEDGER_COLUMNS).order("created_at", { ascending: false });
      expect(rows.data).toHaveLength(1);
    });

    it("an invalid GSTIN is rejected by the database too", async () => {
      const u2 = newUser();
      const sb2 = clientFor(u2);
      await recordMissingConsents(sb2, RECRUITER_CONSENTS);
      const err = await createRecruiterProfile(sb2, { ...buildCreateRecruiterArgs({ companyName: "X", gstin: "" }), p_gstin: "NOT-A-GSTIN" }).catch((e) => e);
      expect((err as AppError).message).toMatch(/GSTIN/);
    });

    it("beta: every new recruiter gets exactly one free preview, with no phone number on file", async () => {
      const u3 = newUser();
      const sb3 = clientFor(u3);
      await recordMissingConsents(sb3, RECRUITER_CONSENTS);
      await createRecruiterProfile(sb3, buildCreateRecruiterArgs({ companyName: "", gstin: "" }));
      const ledger = await sb3.from("credits_ledger").select("reason").eq("reason", "trial_grant");
      expect(ledger.data).toHaveLength(1);
      expect(sql(`select trial_unlocks_remaining||','||coalesce(phone_e164,'none') from recruiters where user_id='${u3}'`)).toBe("1,none");
    });

    it("a recruiter cannot read the talent contact vault", async () => {
      const vault = await sb.from("talent_private").select("full_name,whatsapp_number");
      expect(vault.error).toBeNull(); // RLS returns zero rows rather than an error for an authenticated user
      expect(vault.data).toHaveLength(0);
    });
  });
});
