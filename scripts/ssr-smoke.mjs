/**
 * SSR smoke test: drives the RUNNING Next.js app with real Supabase sessions (cookies) and checks which page /
 * redirect each kind of user gets. Covers what unit tests can't: proxy + enforce() + server components + RLS together.
 *
 *   npx supabase start
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon> npx next dev -p 3101
 *   node scripts/ssr-smoke.mjs        (reads keys from `npx supabase status -o env`)
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const APP = process.env.APP_URL ?? "http://localhost:3101";
const env = Object.fromEntries(
  execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" })
    .split("\n").map((l) => /^([A-Z_]+)="(.*)"$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const API = env.API_URL, ANON = env.ANON_KEY, SERVICE = env.SERVICE_ROLE_KEY;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(API)) throw new Error("local stack only");

const psql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_devmap", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-c", q], { stdio: ["ignore", "ignore", "ignore"] });
psql("truncate public.recruiters, public.talent_public, public.consents, public.blocklist, public.review_queue cascade");
psql("delete from auth.users where email like '%@smoke.test'");
execFileSync("docker", ["exec", "-i", "supabase_db_devmap", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input: readFileSync("supabase/seed.sql"), stdio: ["pipe", "ignore", "ignore"] }); // truncate removed the seed: restore it

const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
const mk = () => createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

async function user(tag) {
  const email = `${tag}@smoke.test`, password = "Passw0rd!smoke";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const sb = mk();
  const { data, error: e2 } = await sb.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { sb, session: data.session, email };
}

/** Same encoding @supabase/ssr uses: cookie "sb-<host label>-auth-token" = "base64-" + base64url(JSON), chunked at 3180 chars. */
function cookieFor(session) {
  const name = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  if (value.length <= 3180) return `${name}=${value}`;
  const parts = value.match(/.{1,3180}/g);
  return parts.map((p, i) => `${name}.${i}=${p}`).join("; ");
}

async function recordMissingConsents(sb, types) { for (const t of types) { const r = await sb.rpc("record_consent", { p_type: t, p_policy_version: "2026-11-02" }); if (r.error) throw r.error; } }
async function createRecruiterProfile(sb, args) { const r = await sb.rpc("create_recruiter_profile", args); if (r.error) throw r.error; }
let failed = 0;
async function check(label, cookie, path, expect) {
  const res = await fetch(APP + path, { redirect: "manual", headers: cookie ? { cookie } : {} });
  const loc = res.headers.get("location");
  const target = loc ? new URL(loc, APP).pathname : null;
  // React inserts <!-- --> between adjacent text nodes ("Step 1 of 6" is "Step <!-- -->1<!-- --> of ..."): strip them.
  const body = res.status === 200 ? (await res.text()).replaceAll("<!-- -->", "") : "";
  let ok = res.status === expect.status;
  if (expect.to) ok &&= target === expect.to;
  for (const needle of expect.has ?? []) ok &&= body.includes(needle);
  for (const needle of expect.hasNot ?? []) ok &&= !body.includes(needle);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${path.padEnd(22)} -> ${res.status}${target ? " " + target : ""}${ok ? "" : "   (expected " + JSON.stringify(expect) + ")"}`);
}

console.log("== A. brand-new signed-in user (no profile yet)");
const a = await user("newbie"); const ca = cookieFor(a.session);
await check("signed-in user is bounced off /login", ca, "/login", { status: 307, to: "/dashboard" });
await check("/dashboard signpost -> role chooser", ca, "/dashboard", { status: 307, to: "/onboard" });
await check("role chooser renders", ca, "/onboard", { status: 200, has: ["How will you use DevMap"] });
await check("talent onboarding renders (step 1)", ca, "/onboard/talent", { status: 200, has: ["What do you do?", "Step 1 of 6"] });
await check("?role=developer w/o GitHub starts on step 1", ca, "/onboard/talent?role=developer", { status: 200, has: ["Step 1 of 6"] });
await check("recruiter onboarding renders (no phone step in the beta)", ca, "/onboard/recruiter", { status: 200, has: ["Tell us about your business"], hasNot: ["Verify your mobile number"] });
await check("incomplete talent -> talent onboarding", ca, "/dashboard/talent", { status: 307, to: "/onboard/talent" });
await check("incomplete recruiter -> recruiter onboarding", ca, "/explore", { status: 307, to: "/onboard/recruiter" });
await check("the old verify-phone page is gone", ca, "/onboard/verify-phone", { status: 404 });

console.log("== B. user who finished TALENT onboarding (designer)");
const b = await user("designer"); const cb = cookieFor(b.session);
const { createTalentProfile } = await import("./_rpc-for-smoke.mjs");
await recordMissingConsents(b.sb, ["dpdp_directory_listing", "contact_disclosure", "phone_processing"]);
await createTalentProfile(b.sb, {
  p_role: "designer", p_full_name: "Anita Das", p_city: "Jorhat", p_state: "Assam", p_latitude: 26.7509, p_longitude: 94.2037,
  p_native_language: "Assamese", p_secondary_languages: ["English"], p_skills: ["figma"], p_hourly_rate_paise: 45000,
  p_phone_e164: "+919800011111", p_whatsapp_number: "+919800011111", p_email: "anita@smoke.test", p_portfolio_links: [],
});
await check("finished talent skips /onboard/talent", cb, "/onboard/talent", { status: 307, to: "/dashboard/talent" });
await check("/dashboard -> talent dashboard", cb, "/dashboard", { status: 307, to: "/dashboard/talent" });
await check("dashboard shows masked name + checklist + gate", cb, "/dashboard/talent", { status: 200, has: ["Anita D.", "Projects added", "Not visible to recruiters yet", "Availability", "email you"], hasNot: ["Anita Das", "Verify phone", "Telegram", "Phone verified"] });
await check("talent without recruiter profile -> own dashboard", cb, "/explore", { status: 307, to: "/dashboard/talent" });
await check("talent may still open recruiter onboarding", cb, "/onboard/recruiter", { status: 200 });

console.log("== C. user who finished RECRUITER onboarding");
const c = await user("recruiter"); const cc = cookieFor(c.session);
await recordMissingConsents(c.sb, ["recruiter_terms"]);
await createRecruiterProfile(c.sb, { p_phone_e164: null, p_company_name: "Acme Pvt Ltd", p_gstin: null });
await check("/dashboard -> /explore", cc, "/dashboard", { status: 307, to: "/explore" });
await check("explore shows credits + free preview in ledger", cc, "/explore", { status: 200, has: ["Acme Pvt Ltd", "Free preview", "Free preview granted"] });
await check("finished recruiter skips recruiter onboarding", cc, "/onboard/recruiter", { status: 307, to: "/explore" });
await check("recruiter has no talent dashboard", cc, "/dashboard/talent", { status: 307, to: "/onboard/talent" });

console.log("== E. Sprint 2: discovery pages (recruiter session)");
const names = ["Rahul S.", "Priya N.", "Aditi M.", "Pallavi R."];
await check("explore renders masked cards, prices and map shell", cc, "/explore", { status: 200, has: ["Find someone great, nearby.", "What do you need?", "on the map", ...names, "Unlock free (preview)", "Unlock · 2 credits", "Loading map"], hasNot: ["Rahul Sharma", "Priya Nair", "9000000001", "mock1@example.invalid", "example.invalid"] });
await check("no real name / phone / url anywhere in the page", cc, "/explore", { status: 200, hasNot: ["Aditi Mehta", "+919000000007", "mock-1-1", "telegram"] });
await check("role filter (designers only)", cc, "/explore?role=designer", { status: 200, has: ["Aditi M.", "Rupa M."], hasNot: ["Rahul S.", "Pallavi R."] });
await check("intent: I need an app -> mobile developers only", cc, "/explore?intent=app", { status: 200, has: ["Rahul S.", "Karthik I.", "Arnab S."], hasNot: ["Priya N.", "Aditi M."] });
await check("intent: content in my language -> copywriters", cc, "/explore?intent=regional-content", { status: 200, has: ["Jyoti P.", "Pallavi R."], hasNot: ["Rahul S."] });
await check("language filter Telugu (native OR second language)", cc, "/explore?language=Telugu", { status: 200, has: ["Nandini R.", "Karthik I.", "Pallavi R."], hasNot: ["Rahul S."] });
await check("a city with nobody shows builders within ~250 km, closest city first, with a notice", cc, "/explore?city=Nashik", { status: 200, has: ["Nobody in Nashik yet. Showing builders within about 250 km.", "Meera J."] });
await check("a city with nobody nearby falls back to all of India, and says work is remote", cc, "/explore?city=Tezpur", { status: 200, has: ["Nobody near Tezpur yet. Showing the best matches across India."] });
await check("a state filter works on its own", cc, "/explore?state=West%20Bengal", { status: 200, has: ["Arnab S.", "Tanmoy D."], hasNot: ["Rahul S."] });
await check("an unmatched language is NEVER dropped", cc, "/explore?language=Nepali", { status: 200, has: ["No builders match yet"], hasNot: ["Rahul S.", "Broadened"] });
await check("junk filter values are ignored, not trusted", cc, "/explore?role=admin&city=x,role.eq.admin&language=Hindi),id.neq.x", { status: 200, has: ["Rahul S."] });
await check("a talent (not recruiter) cannot see discovery", cb, "/explore", { status: 307, to: "/dashboard/talent" });

console.log("== F. Sprint 2: payment routes (mock Razorpay, real database)");
const KEY_SECRET = "mock_key_secret", WEBHOOK_SECRET = "mock_webhook_secret";
const hmac = (secret, payload) => createHmac("sha256", secret).update(payload).digest("hex");
async function api(label, path, { cookie, origin = APP, body, raw, headers = {}, expect }) {
  const res = await fetch(APP + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...headers }, body: raw ?? JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  let ok = res.status === expect.status;
  for (const [k, v] of Object.entries(expect.json ?? {})) ok &&= JSON.stringify(data[k]) === JSON.stringify(v);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(66)} -> ${res.status} ${JSON.stringify(data).slice(0, 110)}${ok ? "" : "   (expected " + JSON.stringify(expect) + ")"}`);
  return data;
}
const balance = async () => (await c.sb.from("recruiters").select("credits_balance").single()).data.credits_balance;
const key1 = randomUUID();
await api("create-order without an Origin header is blocked (CSRF)", "/api/payments/create-order", { cookie: cc, origin: null, body: { bundleId: "credits_3", idempotencyKey: key1 }, expect: { status: 403, json: { error: "bad_origin" } } });
await api("create-order from another origin is blocked", "/api/payments/create-order", { cookie: cc, origin: "https://evil.example", body: { bundleId: "credits_3", idempotencyKey: key1 }, expect: { status: 403 } });
await api("create-order when signed out -> 401", "/api/payments/create-order", { body: { bundleId: "credits_3", idempotencyKey: key1 }, expect: { status: 401 } });
await api("create-order with a malformed body -> 400", "/api/payments/create-order", { cookie: cc, body: { bundleId: "credits_3", idempotencyKey: "not-a-uuid" }, expect: { status: 400 } });
await api("create-order for an unknown bundle -> 404", "/api/payments/create-order", { cookie: cc, body: { bundleId: "credits_999", idempotencyKey: randomUUID() }, expect: { status: 404 } });
await api("a talent without recruiter profile cannot create orders", "/api/payments/create-order", { cookie: cb, body: { bundleId: "credits_3", idempotencyKey: randomUUID() }, expect: { status: 403 } });
const o1 = await api("create-order: server prices the bundle (3 credits = 24900 paise)", "/api/payments/create-order", { cookie: cc, body: { bundleId: "credits_3", idempotencyKey: key1 }, expect: { status: 200, json: { amountPaise: 24900, credits: 3, mode: "mock" } } });
const o1b = await api("same idempotency key -> same order, no duplicate", "/api/payments/create-order", { cookie: cc, body: { bundleId: "credits_3", idempotencyKey: key1 }, expect: { status: 200, json: { orderId: o1.orderId } } });
console.log(o1b.orderId === o1.orderId ? "PASS  idempotent order id" : (failed++, "FAIL  idempotent order id"));

console.log("-- webhook: signature and amount");
const evt = (orderId, paymentId, amount, event = "payment.captured") => JSON.stringify({ event, payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: "INR", status: "captured" } } } });
const wh = (body, sig) => ({ raw: body, headers: { "x-razorpay-signature": sig }, origin: null });
await api("webhook with NO signature -> 400", "/api/webhooks/razorpay", { ...wh(evt(o1.orderId, "pay_a", 24900), ""), expect: { status: 400, json: { error: "bad_signature" } } });
await api("webhook signed with the WRONG secret -> 400", "/api/webhooks/razorpay", { ...wh(evt(o1.orderId, "pay_a", 24900), hmac("not-the-secret", evt(o1.orderId, "pay_a", 24900))), expect: { status: 400 } });
const forged = evt(o1.orderId, "pay_a", 24900);
await api("webhook body altered after signing -> 400", "/api/webhooks/razorpay", { ...wh(forged.replace("24900", "100"), hmac(WEBHOOK_SECRET, forged)), expect: { status: 400 } });
const cheap = evt(o1.orderId, "pay_a", 100);
await api("validly signed but WRONG AMOUNT -> refused, nothing credited", "/api/webhooks/razorpay", { ...wh(cheap, hmac(WEBHOOK_SECRET, cheap)), expect: { status: 200, json: { ignored: "amount_mismatch" } } });
console.log((await balance()) === 0 ? "PASS  balance still 0" : (failed++, "FAIL  balance changed after refused webhook"));
const failedEvt = evt(o1.orderId, "pay_a", 24900, "payment.failed");
await api("unrelated event types are acknowledged and ignored", "/api/webhooks/razorpay", { ...wh(failedEvt, hmac(WEBHOOK_SECRET, failedEvt)), expect: { status: 200, json: { ignored: "event_not_handled" } } });
const good = evt(o1.orderId, "pay_good_1", 24900);
await api("correct webhook -> credits granted", "/api/webhooks/razorpay", { ...wh(good, hmac(WEBHOOK_SECRET, good)), expect: { status: 200, json: { status: "captured" } } });
await api("the SAME webhook again (Razorpay retry) -> already captured", "/api/webhooks/razorpay", { ...wh(good, hmac(WEBHOOK_SECRET, good)), expect: { status: 200, json: { status: "already_captured" } } });
console.log((await balance()) === 3 ? "PASS  balance is exactly 3 after a replayed webhook" : (failed++, `FAIL  balance is ${await balance()}, expected 3`));

console.log("-- checkout callback (/verify)");
const o2 = await api("create a second order", "/api/payments/create-order", { cookie: cc, body: { bundleId: "credits_3", idempotencyKey: randomUUID() }, expect: { status: 200 } });
await api("verify with a bad signature -> 400", "/api/payments/verify", { cookie: cc, body: { razorpay_order_id: o2.orderId, razorpay_payment_id: "pay_v2", razorpay_signature: "deadbeef" }, expect: { status: 400, json: { error: "bad_signature" } } });
const sig2 = hmac(KEY_SECRET, `${o2.orderId}|pay_v2`);
await api("verify signed with the WEBHOOK secret (wrong one) -> 400", "/api/payments/verify", { cookie: cc, body: { razorpay_order_id: o2.orderId, razorpay_payment_id: "pay_v2", razorpay_signature: hmac(WEBHOOK_SECRET, `${o2.orderId}|pay_v2`) }, expect: { status: 400 } });
const other = await user("otherrec"); const co = cookieFor(other.session);
await recordMissingConsents(other.sb, ["recruiter_terms"]); await createRecruiterProfile(other.sb, { p_phone_e164: null, p_company_name: "Other Co", p_gstin: null });
await api("verify an order that belongs to SOMEONE ELSE -> 403, nothing credited", "/api/payments/verify", { cookie: co, body: { razorpay_order_id: o2.orderId, razorpay_payment_id: "pay_v2", razorpay_signature: sig2 }, expect: { status: 403, json: { error: "not_yours" } } });
await api("verify with the right signature -> credited", "/api/payments/verify", { cookie: cc, body: { razorpay_order_id: o2.orderId, razorpay_payment_id: "pay_v2", razorpay_signature: sig2 }, expect: { status: 200, json: { status: "captured" } } });
await api("verify again (browser retry) -> already captured", "/api/payments/verify", { cookie: cc, body: { razorpay_order_id: o2.orderId, razorpay_payment_id: "pay_v2", razorpay_signature: sig2 }, expect: { status: 200, json: { status: "already_captured" } } });
console.log((await balance()) === 6 ? "PASS  balance is 6 (3 + 3), no double credit" : (failed++, `FAIL  balance is ${await balance()}, expected 6`));

console.log("-- dev 'simulate payment' button -> signed webhook -> credits");
const o3 = await api("create a third order", "/api/payments/create-order", { cookie: cc, body: { bundleId: "credits_10", idempotencyKey: randomUUID() }, expect: { status: 200, json: { amountPaise: 79900, credits: 10 } } });
await api("mock-pay for another user's order -> 404", "/api/dev/mock-pay", { cookie: co, body: { orderId: o3.orderId }, expect: { status: 404 } });
await api("mock-pay posts a SIGNED webhook through the real handler", "/api/dev/mock-pay", { cookie: cc, body: { orderId: o3.orderId }, expect: { status: 200, json: { webhookStatus: 200 } } });
console.log((await balance()) === 16 ? "PASS  balance is 16 (6 + 10)" : (failed++, `FAIL  balance is ${await balance()}, expected 16`));

console.log("-- spend the credits: elite unlock through the database function");
const { data: contact, error: uerr } = await c.sb.rpc("unlock_talent_contact", { p_talent_id: "00000000-0000-4000-8000-000000000001" });
console.log(!uerr && contact.full_name === "Rahul Sharma" && Object.keys(contact).length === 4 ? "PASS  elite profile unlocked: 4 fields returned" : (failed++, `FAIL  unlock: ${JSON.stringify(uerr ?? contact)}`));
console.log((await balance()) === 14 ? "PASS  balance is 14 (16 - 2 for an elite profile)" : (failed++, `FAIL  balance is ${await balance()}, expected 14`));
await check("explore now shows Rahul as unlocked + new balance", cc, "/explore", { status: 200, has: ["View contact", "Unlocked ✓", "Credit history", "Credits purchased", "Unlocked an elite profile"] });

console.log("== D. signed-out / tampered sessions");
for (const p of ["/dashboard", "/dashboard/talent", "/onboard/talent", "/explore"]) {
  await check("no cookie", null, p, { status: 307, to: "/login" });
}
await check("garbage session cookie", "sb-127-auth-token=base64-AAAA", "/dashboard", { status: 307, to: "/login" });
// (the globe itself is WebGL, rendered only in the browser, so its caption is not in the server HTML)
await check("home page is public and server-rendered", null, "/", { status: 200, has: ["Hire verified local talent", "How it works", "Zero commission", "Open across India"] });

console.log("== E. footer + legal pages (public, signed out)");
await check("home shows the legal footer", null, "/", { status: 200, has: ["Terms of Service", "Privacy Policy", "Refunds &amp; Cancellation", "Pricing", "Contact", "diadem.xeiver@gmail.com"] });
await check("footer is on app pages too", cc, "/explore", { status: 200, has: ["Terms of Service", "Privacy Policy"] });
await check("terms are real text, not a placeholder", null, "/terms", { status: 200, has: ["Terms of Service", "no commission", "our team reviews it", "registered office"], hasNot: ["Placeholder", "written and reviewed by a lawyer"] });
await check("privacy covers data classes, rights and the grievance route", null, "/privacy", { status: 200, has: ["Privacy Policy", "Data Fiduciary", "7 years", "Grievance Officer", "GitHub ID"], hasNot: ["Placeholder"] });
await check("refunds explain the review process and what is not refunded", null, "/refunds", { status: 200, has: ["Refunds", "reviews every report", "Free previews", "5 to 7 working days"], hasNot: ["Telegram"] });
await check("pricing reads the real packs from the database, GST-inclusive", null, "/pricing", { status: 200, has: ["₹99", "₹249", "₹799", "Inclusive of GST", "1 credit", "2 credits"] });
await check("contact shows the support address and grievance contact", null, "/contact", { status: 200, has: ["diadem.xeiver@gmail.com", "Grievance Officer"] });
await check("unset company facts are left out, never invented", null, "/contact", { status: 200, hasNot: ["Who we are", "GSTIN:"] });

console.log("== F. a session for a user that no longer exists (account erased / database reset) must not loop");
{
  /** Follows redirects like a browser: obeys Set-Cookie (incl. deletion) and gives up after 8 hops. */
  async function browse(start, session) {
    const name = `sb-${new URL(API).hostname.split(".")[0]}-auth-token`;
    const jar = new Map(session ? [[name, "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url")]] : []);
    let url = APP + start; const path = [];
    for (let i = 0; i < 8; i++) {
      const r = await fetch(url, { redirect: "manual", headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
      for (const c of r.headers.getSetCookie()) { const [kv, ...a] = c.split(";"); const [k, ...v] = kv.split("="); const gone = a.some((x) => /max-age=0/i.test(x) || /expires=thu, 01 jan 1970/i.test(x)) || v.join("") === ""; if (gone) jar.delete(k.trim()); else jar.set(k.trim(), v.join("=")); }
      const loc = r.headers.get("location");
      path.push(`${r.status} ${new URL(url).pathname}`);
      if (!loc) return { path, final: new URL(url).pathname, status: r.status, cookies: jar.size };
      url = new URL(loc, url).toString();
    }
    return { path, final: "LOOP", status: 0, cookies: jar.size };
  }
  const ghost = await user("ghost");
  await admin.auth.admin.deleteUser(ghost.session.user.id);
  for (const p of ["/dashboard", "/explore", "/onboard", "/admin/review-queue"]) {
    const r = await browse(p, ghost.session);
    const ok = r.final === "/login" && r.status === 200 && r.path.length <= 4 && r.cookies === 0;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  dead session on ${p.padEnd(22)} -> ${r.path.join(" > ")}  (cookies left: ${r.cookies})`);
  }
  const live = await user("alive");
  const r = await browse("/auth/reset?next=/dashboard", live.session);
  const okLive = r.path[0] === "307 /auth/reset" && r.cookies > 0 && r.final !== "/login";
  if (!okLive) failed++;
  console.log(`${okLive ? "PASS" : "FAIL"}  a VALID session is never logged out by /auth/reset -> ${r.path.join(" > ")}`);
  const anon = await browse("/auth/reset?next=https://evil.example", null);
  const okAnon = anon.final === "/login";
  if (!okAnon) failed++;
  console.log(`${okAnon ? "PASS" : "FAIL"}  signed out: /auth/reset goes to /login, and an off-site next is neutralised -> ${anon.path.join(" > ")}`);
}

console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nALL SSR CHECKS PASSED");
process.exit(failed ? 1 : 0);
