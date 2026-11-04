/**
 * Workers + beta flow smoke test: drives the RUNNING Next.js app + the REAL local Supabase stack end to end.
 *   - the two cron routes (bearer secret)
 *   - the beta flow: a developer and a recruiter onboard with NO phone step; an unlock; a ghost report that goes to a human
 *   - the pinger refusing SSRF targets (a verified project pointing at 127.0.0.1 and at the cloud-metadata IP)
 *
 *   npx supabase start
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   CRON_SECRET=smoke_cron_secret_123456 MAIL_MODE=mock npx next dev -p 3101
 *   CRON_SECRET=smoke_cron_secret_123456 node scripts/workers-smoke.mjs
 *
 * Non-destructive: it creates fresh, randomly named users and leaves the seed data alone.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const APP = process.env.APP_URL ?? "http://localhost:3101";
const CRON = process.env.CRON_SECRET;
if (!CRON) throw new Error("Set CRON_SECRET to the same value the app was started with.");
const env = Object.fromEntries(
  execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
    .split("\n").map((l) => /^([A-Z_]+)="(.*)"$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const API = env.API_URL, ANON = env.ANON_KEY, SERVICE = env.SERVICE_ROLE_KEY;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(API)) throw new Error("local stack only");

const psql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_devmap", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q", "-c", q], { encoding: "utf8" }).trim();
const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
const mk = () => createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const digits = () => String(Math.floor(Math.random() * 9e8) + 1e8);

let failed = 0;
function ok(label, cond, extra = "") {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : "   " + extra}`);
  return cond;
}
async function http(method, path, { headers = {}, body } = {}) {
  const res = await fetch(APP + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const cron = (name, method = "GET") => http(method, `/api/cron/${name}`, { headers: { authorization: `Bearer ${CRON}` } });

async function user(tag) {
  const email = `${tag}-${run}@s3smoke.test`, password = "Passw0rd!smoke";
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const sb = mk();
  const { data: signedIn, error: e2 } = await sb.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { sb, id: created.user.id, email, session: signedIn.session };
}
/** Same encoding @supabase/ssr uses: cookie "sb-<host label>-auth-token" = "base64-" + base64url(JSON), chunked at 3180 chars. */
function cookieFor(session) {
  const name = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  if (value.length <= 3180) return `${name}=${value}`;
  return value.match(/.{1,3180}/g).map((p, i) => `${name}.${i}=${p}`).join("; ");
}
async function page(path, session) {
  const res = await fetch(APP + path, { redirect: "manual", headers: session ? { cookie: cookieFor(session) } : {} });
  return { status: res.status, location: res.headers.get("location"), body: res.status === 200 ? (await res.text()).replaceAll("<!-- -->", "") : "" };
}
const consents = async (sb, types) => { for (const t of types) { const r = await sb.rpc("record_consent", { p_type: t, p_policy_version: "2026-11-02" }); if (r.error) throw r.error; } };

console.log("== A. endpoint gates");
{
  for (const name of ["github-score", "ping"]) {
    for (const method of ["GET", "POST"]) {
      ok(`cron/${name} ${method}: no auth -> 401`, (await http(method, `/api/cron/${name}`)).status === 401);
    }
    ok(`cron/${name}: wrong bearer -> 401`, (await http("GET", `/api/cron/${name}`, { headers: { authorization: "Bearer nope" } })).status === 401);
    ok(`cron/${name}: the secret as a bare header (no 'Bearer') -> 401`, (await http("GET", `/api/cron/${name}`, { headers: { authorization: CRON } })).status === 401);
  }
  ok("the Telegram routes are gone", (await http("POST", "/api/webhooks/telegram", { body: {} })).status === 404 && (await http("GET", "/api/cron/dispatch", { headers: { authorization: `Bearer ${CRON}` } })).status === 404);
}

console.log("== B. a developer onboards with no phone step (beta)");
const dev = await user("dev");
const ghLogin = `s3-${run}`;
psql(`insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values ('gh-${run}', '${dev.id}', '{"sub":"gh-${run}","user_name":"${ghLogin}"}', 'github', now(), now(), now())`);
await consents(dev.sb, ["dpdp_directory_listing", "contact_disclosure", "phone_processing"]);
const phone = "+9198" + digits().slice(0, 8);
{
  const r = await dev.sb.rpc("create_talent_profile", {
    p_role: "developer", p_full_name: "Smoke Developer", p_city: "Surat", p_state: "Gujarat", p_latitude: 21.1702, p_longitude: 72.8311,
    p_native_language: "Gujarati", p_secondary_languages: ["English"], p_skills: ["react"], p_hourly_rate_paise: 50000,
    p_phone_e164: phone, p_whatsapp_number: phone, p_email: dev.email, p_portfolio_links: [],
  });
  if (r.error) throw r.error;
  var talentId = r.data;
}
psql(`update public.talent_public set proof_score = 50 where id='${talentId}'`);
{
  ok("the profile is ready without any OTP", psql(`select is_phone_verified from public.talent_private where talent_id='${talentId}'`) === "t");
  const online = await dev.sb.from("talent_public").update({ is_online: true }).eq("id", talentId);
  ok("the developer can go Online with no Telegram", online.error === null, JSON.stringify(online.error));
}

console.log("== C. a recruiter onboards with no phone, and unlocks");
const rec = await user("rec");
await consents(rec.sb, ["recruiter_terms"]);
{
  const r = await rec.sb.rpc("create_recruiter_profile", { p_phone_e164: null, p_company_name: "Smoke Co", p_gstin: null });
  if (r.error) throw r.error;
  ok("recruiter profile needs no phone number", psql(`select phone_e164 is null from public.recruiters where user_id='${rec.id}'`) === "t");
  ok("...and still gets the one free preview", psql(`select trial_unlocks_remaining from public.recruiters where user_id='${rec.id}'`) === "1");
  const u = await rec.sb.rpc("unlock_talent_contact", { p_talent_id: talentId });
  ok("recruiter unlocks the developer (free preview) and gets the WhatsApp number", !u.error && u.data?.whatsapp_number === phone, JSON.stringify(u.error));
  var unlockId = psql(`select id from public.lead_unlocks where talent_id='${talentId}'`);
  ok("nothing is queued for Telegram", psql(`select count(*) from public.telegram_outbox where talent_id='${talentId}'`) === "0");
}

console.log("== D. a ghost report goes to a human, never an automatic refund");
{
  psql(`update public.lead_unlocks set is_trial=false, credits_deducted=1, has_clicked_whatsapp=true, whatsapp_clicked_at=now()-interval '30 hours' where id='${unlockId}'`);
  const rep = await rec.sb.rpc("report_ghosting", { p_talent_id: talentId, p_note: "no reply" });
  ok("recruiter files a ghost report", !rep.error, JSON.stringify(rep.error));
  psql(`update public.ghost_reports set talent_deadline = now() - interval '1 minute' where id='${rep.data}'`);
  psql(`select private.resolve_expired_ghost_reports()`);
  ok("after the window the report is UNDER REVIEW, not refunded", psql(`select status from public.ghost_reports where id='${rep.data}'`) === "under_review");
  ok("it landed in the admin review queue", psql(`select count(*) from public.review_queue where type='ghost_dispute' and related_id='${rep.data}'`) === "1");
  ok("no refund and no strike until a person decides", psql(`select refunded_at is null from public.lead_unlocks where id='${unlockId}'`) === "t" && psql(`select count(*) from public.strikes where talent_id='${talentId}'`) === "0");
}

console.log("== E. workers: the pinger refuses to be aimed at our own network");
{
  // The DB lets an IP-literal https URL through the insert regex; the WORKER is what must refuse it.
  const loop = psql(`insert into public.projects (talent_id, generic_title, live_url, is_ownership_verified, verification_method, verified_at) values ('${talentId}','Loopback probe','https://127.0.0.1/?r=${run}',true,'well_known_file',now()) returning id`);
  const meta = psql(`insert into public.projects (talent_id, generic_title, live_url, is_ownership_verified, verification_method, verified_at) values ('${talentId}','Metadata probe','https://169.254.169.254/latest/meta-data/?r=${run}',true,'well_known_file',now()) returning id`).split("\n")[0];
  const unv = psql(`insert into public.projects (talent_id, generic_title, live_url) values ('${talentId}','Unverified internal','https://10.0.0.5/?r=${run}') returning id`).split("\n")[0];
  const p = await cron("ping");
  ok("cron/ping runs", p.status === 200 && p.json.pings?.claimed >= 2, JSON.stringify(p));
  ok("both verified internal targets were claimed and recorded as BLOCKED, never fetched", p.json.pings?.blocked >= 2, JSON.stringify(p.json.pings));
  const errs = psql(`select string_agg(error, ',' order by error) from public.ping_results where project_id in ('${loop.split("\n")[0]}','${meta}')`);
  ok("recorded reason is blocked:ip_literal for both", errs === "blocked:ip_literal,blocked:ip_literal", errs);
  ok("blocked pings count as DOWN (no free uptime for an unreachable site)", psql(`select is_up from public.projects where id='${meta}'`) === "f");
  ok("an unverified internal URL stays unverified", psql(`select is_ownership_verified from public.projects where id='${unv}'`) === "f" && (p.json.verification?.verified ?? 0) === 0, JSON.stringify(p.json.verification));
  ok("seed sites were not touched", psql(`select count(*) from public.ping_results r join public.projects p on p.id=r.project_id where p.talent_id::text like '00000000-0000-4000-8000-%' and r.checked_at > now() - interval '5 minutes'`) === "0");
  const again = await cron("ping");
  ok("the next run does not ping them again (random 3-9h schedule)", again.json.pings?.claimed === 0, JSON.stringify(again.json));
}

console.log("== F. workers: GitHub scorer route");
{
  const g = await cron("github-score");
  ok("cron/github-score runs", g.status === 200 && typeof g.json.queued === "number", JSON.stringify(g));
  const bd = psql(`select coalesce(score_breakdown->>'github_scored_at','') <> '' from public.talent_public where id='${talentId}'`);
  ok("the developer was processed (scored, or recorded as not-found / unreachable) so they are not retried every minute", g.json.rateLimited ? true : bd === "t", JSON.stringify(g.json));
  ok("seed developers are never sent to GitHub", psql(`select count(*) from public.talent_public where id::text like '00000000-0000-4000-8000-%' and score_breakdown ? 'github_scored_at'`) === "0");
}

console.log("== G. recruiter's 'My leads' page (server-rendered with a real session)");
{
  const signedOut = await page("/explore/leads", null);
  ok("signed out -> /login", signedOut.status === 307 && new URL(signedOut.location, APP).pathname === "/login");
  const asTalent = await page("/explore/leads", dev.session);
  ok("a talent (no recruiter profile) is sent away", asTalent.status === 307 && new URL(asTalent.location, APP).pathname === "/dashboard/talent", `${asTalent.status} ${asTalent.location}`);
  const mine = await page("/explore/leads", rec.session);
  ok("the recruiter sees their lead by MASKED name", mine.status === 200 && mine.body.includes("Smoke D."), mine.status);
  ok("...never the real name or the phone number", !mine.body.includes("Smoke Developer") && !mine.body.includes(phone));
  ok("...and no way to report it twice", !mine.body.includes("Report: no reply"));
  ok("...but WhatsApp stays available", mine.body.includes("Open WhatsApp"));
  const explore = await page("/explore", rec.session);
  ok("explore links to My leads with a count", explore.status === 200 && /My leads \(1\)/.test(explore.body));
}

console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nALL WORKER SMOKE CHECKS PASSED");
process.exit(failed ? 1 : 0);
