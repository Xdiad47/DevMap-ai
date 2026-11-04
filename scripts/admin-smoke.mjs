/**
 * Sprint 4 smoke test: drives the RUNNING app + REAL local Supabase + REAL SMTP (Mailpit).
 *   - /admin locks: signed out, ordinary user, admin
 *   - the four review queues render real data, and the forms are SUBMITTED (as a no-JS browser would) and change the database
 *   - the full client-attestation journey: talent asks -> real e-mail -> client opens the link (GET changes nothing) -> presses Yes
 *
 *   npx supabase start
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   NEXT_PUBLIC_SITE_URL=http://localhost:3101 ATTESTATION_HMAC_SECRET=<32+ chars> SMTP_URL=smtp://127.0.0.1:54325 \
 *   CRON_SECRET=... npx next dev -p 3101
 *   node scripts/admin-smoke.mjs
 *
 * Leaves the 15 seed profiles untouched: it creates fresh, randomly named users and throwaway talents.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const APP = process.env.APP_URL ?? "http://localhost:3101";
const MAIL = "http://127.0.0.1:54324";
const env = Object.fromEntries(
  execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
    .split("\n").map((l) => /^([A-Z_]+)="(.*)"$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const API = env.API_URL, ANON = env.ANON_KEY, SERVICE = env.SERVICE_ROLE_KEY;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(API)) throw new Error("local stack only");

const psql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_devmap", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q", "-c", q], { encoding: "utf8" }).trim();
const svc = createClient(API, SERVICE, { auth: { persistSession: false } });
const mk = () => createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
let failed = 0;
const ok = (label, cond, extra = "") => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : "   " + extra}`); return cond; };

async function user(tag, appMetadata) {
  const email = `${tag}-${run}@s4smoke.test`, password = "Passw0rd!smoke";
  const { data: created, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: appMetadata });
  if (error) throw error;
  const sb = mk();
  const { data, error: e2 } = await sb.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { sb, id: created.user.id, email, session: data.session };
}
function cookieFor(session) {
  const name = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  return value.length <= 3180 ? `${name}=${value}` : value.match(/.{1,3180}/g).map((p, i) => `${name}.${i}=${p}`).join("; ");
}
async function get(path, session) {
  const res = await fetch(APP + path, { redirect: "manual", headers: session ? { cookie: cookieFor(session) } : {} });
  const body = [200, 400, 404].includes(res.status) ? (await res.text()).replaceAll("<!-- -->", "") : "";
  return { status: res.status, loc: res.headers.get("location") ? new URL(res.headers.get("location"), APP).pathname + new URL(res.headers.get("location"), APP).search : null, body, type: res.headers.get("content-type") };
}
const decode = (s) => s.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

/** Submits a page's <form> the way a browser WITHOUT JavaScript would: every hidden input (incl. Next's action ids) + the button pressed + the fields typed. */
async function submitForm(path, session, { contains, fields = {}, button }) {
  const page = await get(path, session);
  const forms = [...page.body.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1]);
  const html = forms.find((f) => f.includes(contains));
  if (!html) return { status: 0, error: `no <form> containing ${contains}` };
  const fd = new FormData();
  for (const m of html.matchAll(/<input\b[^>]*>/g)) {
    const tag = m[0];
    if (!/type="hidden"/.test(tag)) continue;
    const name = /name="([^"]*)"/.exec(tag)?.[1];
    const value = /value="([^"]*)"/.exec(tag)?.[1] ?? "";
    if (name) fd.append(name, decode(value));
  }
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (button) fd.set(button[0], button[1]);
  const res = await fetch(APP + path, { method: "POST", body: fd, redirect: "manual", headers: { origin: APP, ...(session ? { cookie: cookieFor(session) } : {}) } });
  const loc = res.headers.get("location");
  return { status: res.status, loc: loc ? new URL(loc, APP).pathname + new URL(loc, APP).search : null, text: res.status === 200 ? await res.text() : "" };
}
async function mailTo(to) {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/messages`)).json();
    const hit = list.messages.find((m) => m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()));
    if (hit) return (await (await fetch(`${MAIL}/api/v1/message/${hit.ID}`)).json()).Text;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no mail for " + to);
}
/** A throwaway developer, so strikes/bans never touch the 15 seed profiles. */
function makeTalent() {
  const id = randomUUID(), ph = "+91" + String(Math.floor(Math.random() * 9e9) + 1e9);
  psql(`insert into public.talent_public(id, role, masked_name, city, state, latitude, longitude, native_language, skills, hourly_rate_paise) values ('${id}','developer','Throwaway T.','Guwahati','Assam',26.14,91.73,'Assamese','{react}',50000)`);
  psql(`insert into public.talent_private(talent_id, full_name, phone_e164, whatsapp_number, email, github_username, is_phone_verified, daily_unlock_cap) values ('${id}','Throwaway Person','${ph}','${ph}','t-${id.slice(0, 8)}@s4smoke.test','tw-${id.slice(0, 8)}',true,5)`);
  return { id };
}
const consents = async (sb, types) => { for (const t of types) { const r = await sb.rpc("record_consent", { p_type: t, p_policy_version: "2026-11-02" }); if (r.error) throw r.error; } };

// ------------------------------------------------------------------ people
const admin = await user("admin", { role: "admin" });
const nobody = await user("nobody");
const designer = await user("designer");
await consents(designer.sb, ["dpdp_directory_listing", "contact_disclosure", "phone_processing"]);
const dphone = "+9198" + String(Math.floor(Math.random() * 9e7) + 1e7);
const dr = await designer.sb.rpc("create_talent_profile", {
  p_role: "designer", p_full_name: "Smoke Designer", p_city: "Jorhat", p_state: "Assam", p_latitude: 26.7509, p_longitude: 94.2037,
  p_native_language: "Assamese", p_secondary_languages: [], p_skills: ["figma"], p_hourly_rate_paise: 50000,
  p_phone_e164: dphone, p_whatsapp_number: dphone, p_email: designer.email, p_portfolio_links: ["https://behance.net/smoke-designer"],
});
if (dr.error) throw dr.error;
const designerId = dr.data;
psql(`update auth.users set phone='${dphone.slice(1)}', phone_confirmed_at=now() where id='${designer.id}'`);
await designer.sb.rpc("sync_phone_verification");

console.log("== A. who can open /admin");
{
  const out = await get("/admin/review-queue", null);
  ok("signed out -> /login", out.status === 307 && out.loc?.startsWith("/login"), JSON.stringify(out.loc));
  const n = await get("/admin/review-queue", nobody.session);
  ok("signed-in ordinary user -> 404 (we don't confirm the area exists)", n.status === 404, n.status);
  ok("a talent gets 404 too", (await get("/admin/review-queue", designer.session)).status === 404);
  ok("a talent can't open another person's file either", (await get(`/admin/talent/${designerId}`, designer.session)).status === 404);
  const a = await get("/admin/review-queue", admin.session);
  ok("admin sees the queues", a.status === 200 && a.body.includes("Review queues") && a.body.includes("Portfolios"), a.status);
  ok("/admin -> /admin/review-queue", (await get("/admin", admin.session)).loc === "/admin/review-queue");
}

console.log("== B. portfolio queue: render, then submit the real form");
{
  const list = await get("/admin/review-queue?group=portfolio", admin.session);
  ok("the new designer is in the queue by masked name", list.body.includes("Smoke D.") && list.body.includes("designer"), list.status);
  const qid = psql(`select id from public.review_queue where talent_id='${designerId}' and type='designer_portfolio'`);
  const page = await get(`/admin/review-queue/${qid}`, admin.session);
  ok("the detail page shows the real name, the link and the designer rubric", page.body.includes("Smoke Designer") && page.body.includes("behance.net/smoke-designer") && page.body.includes("Design-system rigour"), page.status);
  ok("...but no phone number, e-mail or chat id", !page.body.includes(dphone) && !page.body.includes(designer.email) && !page.body.includes(dphone.slice(3)));
  const r = await submitForm(`/admin/review-queue/${qid}`, admin.session, { contains: 'name="s1"', fields: { s1: "8", s2: "7", s3: "6", s4: "5", notes: "good range" }, button: ["tier", "reviewed"] });
  ok("submitting the form redirects back to the queue", r.status === 303 && r.loc?.startsWith("/admin/review-queue?group=portfolio&done=1"), JSON.stringify(r));
  ok("the database recorded the review: reviewed, 26 work-depth, proof 36, listed", psql(`select review_status||' '||(score_breakdown->>'work_depth')||' '||proof_score||' '||is_listed from public.talent_public where id='${designerId}'`) === "reviewed 26 36 true");
  ok("the queue item names the real admin as reviewer", psql(`select reviewer_id='${admin.id}' and status='approved' from public.review_queue where id='${qid}'`) === "t");
  ok("the action is in the audit log under that admin", psql(`select count(*) from public.admin_audit_log where admin_id='${admin.id}' and target_id='${designerId}'`) === "1");
  const resolved = await get("/admin/review-queue?group=portfolio&state=resolved", admin.session);
  ok("it now shows under Resolved", resolved.body.includes("Smoke D."));
}

console.log("== C. ghost report that expired -> a person decides -> uphold");
{
  const { id: talent } = makeTalent();
  const rec = psql(`insert into public.recruiters(phone_e164, is_phone_verified, company_name) values ('+91${String(Math.floor(Math.random() * 9e9) + 1e9)}', true, 'Smoke Hiring Co') returning id`).split("\n")[0];
  const unlock = psql(`insert into public.lead_unlocks(recruiter_id, talent_id, tier_at_unlock, credits_deducted, is_trial, talent_online_at_unlock, has_clicked_whatsapp, whatsapp_clicked_at) values ('${rec}','${talent}','standard',2,false,true,true,now()-interval '30 hours') returning id`).split("\n")[0];
  const rep = psql(`insert into public.ghost_reports(unlock_id, recruiter_id, talent_id, talent_deadline, recruiter_note) values ('${unlock}','${rec}','${talent}', now()+interval '10 hours', 'silent for 30 hours') returning id`).split("\n")[0];
  // The talent cannot answer in the beta (no Telegram), so the deadline passing hands the case to a person.
  psql(`update public.ghost_reports set talent_deadline = now() - interval '1 minute' where id='${rep}'`);
  psql(`select private.resolve_expired_ghost_reports()`);
  const qid = psql(`select id from public.review_queue where related_id='${rep}' and type='ghost_dispute'`);
  const page = await get(`/admin/review-queue/${qid}`, admin.session);
  ok("shows the recruiter's side", page.body.includes("silent for 30 hours") && page.body.includes("Smoke Hiring Co"), page.status);
  const noReason = await submitForm(`/admin/review-queue/${qid}`, admin.session, { contains: 'name="reportId"', fields: { notes: "" }, button: ["decision", "uphold"] });
  ok("a decision without a reason is NOT accepted (nothing changes)", psql(`select status from public.ghost_reports where id='${rep}'`) === "under_review", JSON.stringify(noReason).slice(0, 120));
  const r = await submitForm(`/admin/review-queue/${qid}`, admin.session, { contains: 'name="reportId"', fields: { notes: "screenshot is from last week" }, button: ["decision", "uphold"] });
  ok("uphold submits and redirects", r.status === 303 && r.loc?.startsWith("/admin/review-queue?group=ghost&done=1"), JSON.stringify(r));
  ok("report upheld, recruiter refunded 2, talent got a strike", psql(`select status from public.ghost_reports where id='${rep}'`) === "upheld" && psql(`select credits_balance from public.recruiters where id='${rec}'`) === "2" && psql(`select count(*) from public.strikes where report_id='${rep}'`) === "1");
}

console.log("== D. strike 3 -> ban review -> decision");
{
  const { id: talent } = makeTalent();
  for (let i = 0; i < 3; i++) {
    const rec = psql(`insert into public.recruiters(phone_e164, is_phone_verified) values ('+91${String(Math.floor(Math.random() * 9e9) + 1e9)}', true) returning id`).split("\n")[0];
    const u = psql(`insert into public.lead_unlocks(recruiter_id, talent_id, tier_at_unlock, credits_deducted, is_trial, talent_online_at_unlock, has_clicked_whatsapp, whatsapp_clicked_at) values ('${rec}','${talent}','standard',1,false,true,true,now()-interval '30 hours') returning id`).split("\n")[0];
    const rp = psql(`insert into public.ghost_reports(unlock_id, recruiter_id, talent_id, talent_deadline) values ('${u}','${rec}','${talent}', now()+interval '1 hour') returning id`).split("\n")[0];
    psql(`select private.apply_strike('${talent}','${rp}')`);
  }
  const qid = psql(`select id from public.review_queue where talent_id='${talent}' and type='ban_review' and status='pending'`);
  const page = await get(`/admin/review-queue/${qid}`, admin.session);
  ok("ban review shows three active strikes and the decision options", page.status === 200 && /Ban permanently/.test(page.body) && /No ban/.test(page.body) && /Restore now/.test(page.body));
  const r = await submitForm(`/admin/review-queue/${qid}`, admin.session, { contains: 'name="talentId"', fields: { notes: "first offence in a year" }, button: ["decision", "dismiss"] });
  ok("'no ban' closes the item without banning", r.status === 303 && psql(`select status from public.review_queue where id='${qid}'`) === "rejected" && psql(`select is_banned from public.talent_public where id='${talent}'`) === "f", JSON.stringify(r));

  // the appeal route: the talent id from the e-mail subject opens the file
  const file = await get(`/admin/talent/${talent}`, admin.session);
  ok("/admin/talent/<id> (the appeal link) shows the file", file.status === 200 && file.body.includes("Lift suspension") && file.body.includes("Smoke") === false && file.body.includes("Strikes"));
  const ban = await submitForm(`/admin/talent/${talent}`, admin.session, { contains: 'name="talentId"', fields: { notes: "fabricated work after review" }, button: ["decision", "ban"] });
  ok("ban from the talent page works and is audited", ban.status === 303 && psql(`select is_banned from public.talent_public where id='${talent}'`) === "t" && Number(psql(`select count(*) from public.admin_audit_log where action='ban' and target_id='${talent}' and admin_id='${admin.id}'`)) === 1, JSON.stringify(ban));
  const rest = await submitForm(`/admin/talent/${talent}`, admin.session, { contains: 'name="talentId"', fields: { notes: "appeal accepted" }, button: ["decision", "restore"] });
  ok("restore (appeal accepted) lifts the ban", rest.status === 303 && psql(`select is_banned from public.talent_public where id='${talent}'`) === "f");
}

console.log("== E. client attestation, end to end with real e-mail");
{
  // the designer (now listed) adds a project and asks a client by e-mail
  const added = await designer.sb.rpc("add_project", { p_title: "Smoke bakery site", p_live_url: `https://bakery-${run}.example.test`, p_repo_url: null });
  if (added.error) throw added.error;
  const dash = await get("/dashboard/talent", designer.session);
  ok("the dashboard offers 'Ask them to confirm' on an unverified project", dash.status === 200 && dash.body.includes("Built it for a client?"), dash.status);

  const clientAddr = `client-${run}@s4smoke.test`;
  const own = await submitForm("/dashboard/talent", designer.session, { contains: 'name="projectId"', fields: { channel: "email", contact: designer.email } });
  ok("asking with the talent's OWN e-mail is refused (and sends nothing)", (own.text ?? "").includes("That&#x27;s your own e-mail") || (own.text ?? "").includes("your own e-mail") , JSON.stringify(own).slice(0, 160));
  ok("...and no attestation row was created for it", psql(`select count(*) from public.client_attestations a join public.projects p on p.id=a.project_id where p.generic_title='Smoke bakery site' and p.talent_id='${designerId}'`) === "0");
  const asked = await submitForm("/dashboard/talent", designer.session, { contains: 'name="projectId"', fields: { channel: "email", contact: clientAddr } });
  ok("asking the client by e-mail is accepted", asked.status === 200 || asked.status === 303, JSON.stringify(asked).slice(0, 160));
  const row = psql(`select a.channel||' '||a.contact_masked||' '||a.status from public.client_attestations a join public.projects p on p.id=a.project_id where p.generic_title='Smoke bakery site' and p.talent_id='${designerId}' order by a.created_at desc limit 1`);
  ok("only a masked label is stored", row === `email c***@s4smoke.test pending`, row);

  const text = await mailTo(clientAddr);
  const token = /\/verify\/attestation\?token=([A-Za-z0-9_-]{43})/.exec(text)?.[1];
  ok("the client received an e-mail with a one-time link on OUR configured address", !!token && text.includes(`${APP}/verify/attestation?token=`), text.slice(0, 200));

  const page = await get(`/verify/attestation?token=${token}`, null);
  ok("the client opens the link with no account: sees who/what, with Yes and No", page.status === 200 && page.body.includes("Smoke D.") && page.body.includes("Smoke bakery site") && page.body.includes("Yes, they built this for me") && page.body.includes(">No<"), page.status);
  ok("opening the link (GET) changed NOTHING", psql(`select a.status from public.client_attestations a join public.projects p on p.id=a.project_id where p.generic_title='Smoke bakery site' and p.talent_id='${designerId}' order by a.created_at desc limit 1`) === "pending");
  ok("nothing identifying the talent's contact is on the client page", !page.body.includes(dphone) && !page.body.includes(designer.email));

  const yes = await submitForm(`/verify/attestation?token=${token}`, null, { contains: 'name="token"', button: ["choice", "yes"] });
  ok("pressing Yes lands on the thank-you page", yes.status === 303 && yes.loc === "/verify/attestation/done?r=confirmed", JSON.stringify(yes));
  ok("the project is now verified by attestation (10 points)", psql(`select verification_method||' '||is_ownership_verified from public.projects where generic_title='Smoke bakery site' and talent_id='${designerId}'`) === "client_attestation true" && psql(`select score_breakdown->>'verification' from public.talent_public where id='${designerId}'`) === "10");
  const again = await get(`/verify/attestation?token=${token}`, null);
  ok("the link is single-use", again.body.includes("expired or was already used"));
  ok("...and the thank-you page renders", (await get("/verify/attestation/done?r=confirmed", null)).body.includes("that&#x27;s confirmed") || (await get("/verify/attestation/done?r=confirmed", null)).body.includes("confirmed"));
  ok("junk tokens are handled", (await get("/verify/attestation?token=x", null)).body.includes("expired or was already used") && (await get("/verify/attestation", null)).status === 200);

  // WhatsApp channel -> always spot-checked
  const p2 = await designer.sb.rpc("add_project", { p_title: "Smoke salon site", p_live_url: `https://salon-${run}.example.test`, p_repo_url: null });
  if (p2.error) throw p2.error;
  const wa = await submitForm("/dashboard/talent", designer.session, { contains: `value="${p2.data.project_id}"`, fields: { channel: "whatsapp", contact: "98111 00" + String(Math.floor(Math.random() * 900) + 100) } });
  ok("WhatsApp channel: accepted, we send nothing", wa.status === 200 || wa.status === 303, JSON.stringify(wa).slice(0, 120));
  // the WhatsApp token never reaches us in a testable form (it is only inside the wa.me link in the response), so create one through SQL-free means:
  // look it up from the DB is impossible (only the hash is stored). Instead confirm via the service role with a token we choose.
  const tok2 = `S4smokeWa${run}` + "x".repeat(24);
  psql(`update public.client_attestations set token_hash=encode(extensions.digest('${tok2}','sha256'),'hex') where project_id=(select id from public.projects where generic_title='Smoke salon site' and talent_id='${designerId}') and status='pending'`);
  const yes2 = await submitForm(`/verify/attestation?token=${tok2}`, null, { contains: 'name="token"', button: ["choice", "yes"] });
  ok("WhatsApp-sent confirmation is accepted...", yes2.loc === "/verify/attestation/done?r=confirmed", JSON.stringify(yes2));
  const aid = psql(`select a.id from public.client_attestations a join public.projects p on p.id=a.project_id where a.channel='whatsapp' and p.talent_id='${designerId}' order by a.created_at desc limit 1`);
  const sc = psql(`select id from public.review_queue where related_id='${aid}' and type='attestation_spotcheck'`);
  ok("...and always lands in the spot-check queue", sc.length > 10);
  const page2 = await get(`/admin/review-queue/${sc}`, admin.session);
  ok("the admin sees the project, the channel (carried by the talent) and the masked contact", page2.body.includes("Smoke salon site") && page2.body.includes("always checked") && /\+91 ••••• ••\d{3}/.test(page2.body), page2.status);
  const rj = await submitForm(`/admin/review-queue/${sc}`, admin.session, { contains: 'name="attestationId"', fields: { notes: "client could not be reached" }, button: ["decision", "reject"] });
  ok("rejecting voids the attested verification", rj.status === 303 && psql(`select is_ownership_verified from public.projects where generic_title='Smoke salon site' and talent_id='${designerId}'`) === "f", JSON.stringify(rj));
  ok("...but the first project (not spot-checked) stays verified", psql(`select is_ownership_verified from public.projects where generic_title='Smoke bakery site' and talent_id='${designerId}'`) === "t");
}

console.log("== F. queue counts");
{
  const a = await get("/admin/review-queue", admin.session);
  ok("tabs show counts", /Portfolios[\s\S]{0,600}Ghost disputes[\s\S]{0,600}Strike 3/.test(a.body));
}

console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nALL ADMIN / ATTESTATION SMOKE CHECKS PASSED");
process.exit(failed ? 1 : 0);
