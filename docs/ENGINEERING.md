> **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# DevMap.in

Verified local talent (developers, designers, marketers), free right now, contactable on WhatsApp.
Spec: [PRD_v2.1.md](PRD_v2.1.md) · Database: [supabase/migrations/](supabase/migrations/)

**Sprint 1:** sign-in, route protection, DPDP consent, phone verification, talent onboarding + dashboard checklist, recruiter onboarding.
**Sprint 2:** discovery (map + list, filters, Intent Gateway), masked profile cards with database-computed unlock prices, credit purchase through Razorpay, and the atomic contact unlock.
**Sprint 4:** the **admin review screens** (`/admin/review-queue`: portfolios, ghost disputes, strike-3 bans, attestation spot-checks, plus `/admin/talent/<id>` for appeals) and **client attestation** (a talent asks a client by e-mail or WhatsApp; the client confirms with one tap, no account).
**Sprint 3:** the Telegram bot (linking, lead alerts with "Got it", ghost-report disputes, weekly check-in, rank changes), the background workers (GitHub scorer, SSRF-guarded uptime pinger, ownership verifier) and the recruiter's post-unlock screen (**My leads**: 👍 / 👎 / 🚩).

#> **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# Run it locally

Prerequisites: Node 22+, Docker, and the Supabase CLI (`npx supabase ...` works without installing).

```bash
> **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# 1. Backend: Postgres + Auth + API, with the migration applied automatically
cp supabase/.env.example supabase/.env      > **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# then add real GitHub/Google OAuth ids (see below)
npx supabase start                           > **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# prints API URL + anon key

> **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# 2. Frontend
cp .env.example .env.local                   > **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# paste the API URL, anon key AND service-role key from step 1
npm install
npm run dev                                  > **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# http://localhost:3000
```

`npx supabase start` / `npx supabase db reset` also loads **`supabase/seed.sql`**: 15 mock talents across India (7 developers, 4 designers, 4 marketers in Bengaluru, Kochi, Pune, Kolkata, Hyderabad, Chennai, Ahmedabad, Mumbai, Delhi and Jaipur; 10 Online, 7 elite) so discovery has something to show. Everything in it is fake, including a mocked `telegram_chat_id` that lets them be Online without the bot.

**Trying the whole recruiter journey locally** (no Razorpay account needed, `RAZORPAY_MODE=mock` is the default in `.env.example`):
sign in with email → verify phone with `98765 43210` / `123456` → company name → `/explore` → unlock **Nabanita H.** with the free preview →
try to unlock **Rahul S.** (elite, 2 credits) → pick a pack → *Simulate UPI payment* → credits arrive → unlock.

| What | Where |
|---|---|
| App | http://localhost:3000 |
| Emails (sign-in links + codes) | http://127.0.0.1:54324 (Mailpit) |
| Phone OTP while testing | number `98765 43210` (also `…11`, `…12`), code **`123456`**, no SMS is sent (`supabase/config.toml` → `[auth.sms.test_otp]`) |
| GitHub / Google sign-in | create an OAuth app each; callback URL `http://127.0.0.1:54321/auth/v1/callback`; put the ids in `supabase/.env`, then `npx supabase stop && npx supabase start` |

Email sign-in works with no setup (code or link arrives in Mailpit). Developers need GitHub sign-in (or to "Connect GitHub" from onboarding).

**Trying the Telegram bot and workers locally** (no bot needed): `.env.example` ships with `TELEGRAM_MODE=mock`, so bot messages are printed in the `npm run dev` console and still marked as sent.
Run the workers with `CRON_SECRET=<same value as .env.local> npm run workers`. Talent can't tap buttons in a fake chat, but `node scripts/workers-smoke.mjs` plays the whole conversation (link → lead → "Got it" → ghost report → dispute) through the real webhook.
For the real bot see *Telegram bot & workers* below.

#> **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# Commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` · `npm run lint` | TypeScript · ESLint |
| `npm test` | Unit tests (routing, redirects, phone, names, validation) |
| `npm run test:contract` | Runs the app's real RPC code against the real migration (Docker, PostgREST) |
| `npm run test:e2e` | Real Supabase Auth end to end: email code, phone OTP with test numbers, profiles, free preview (needs `npx supabase start`) |
| `node scripts/make-admin.mjs <email>` | Makes a user an admin (writes `app_metadata.role`; see *Admin* below) |
| `node scripts/admin-smoke.mjs` | Drives the running app + real Supabase + real SMTP (Mailpit): /admin locks, the four queues and their forms submitted like a no-JS browser, the full client-attestation journey with a real e-mail (start the app with the vars in the file header) |
| `npm run workers` | Local scheduler for the three cron routes (dispatch every minute, ping every 10, GitHub every 15) |
| `npm run telegram:webhook -- set https://<public url>` | Registers the bot's webhook with Telegram (also `info`, `delete`) |
| `node scripts/workers-smoke.mjs` | Drives the running app + real Supabase: webhook secret, cron auth, bot conversation, SSRF refusal by the pinger, My leads page (start the app with `TELEGRAM_MODE=mock`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`; see file header) |
| `node scripts/ssr-smoke.mjs` | Drives the running app (start it with `RAZORPAY_MODE=mock` and the service key, see file header) with real sessions: ~75 checks on redirects, filters, payment routes, forged webhooks, replays and a real unlock |
| `supabase/tests/run_tests.sh` | 131 + 29 + 68 + 62 SQL checks (behaviour, discovery/seed, outbox + worker queues, admin + attestation) and 3 concurrency tests (Docker; `PG_IMAGE=postgres:15` to change version) |

#> **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# How the code is organised

```
src/
  proxy.ts                     Next 16's "middleware": refresh session, send signed-out users to /login
  lib/
    supabase/{client,server,session}.ts   browser / server / proxy clients
    auth/viewer.ts             server-side "who is this & which profiles do they have?" + enforce()
    auth/safe-redirect.ts      stops open redirects via ?next=
    routing.ts                 pure rules: which page may this user see? (unit-tested)
    rpc.ts                     typed wrappers over the migration's functions
    queries.ts                 every column list the app SELECTs (shared with the contract test)
    discovery/                 filters (URL <-> Filters), intents, search + relaxation rules, card extras, button rules
    payments/                  signature.ts, settle.ts (pure, tested), store.ts, config-core.ts, razorpay.ts
    telegram/                  api.ts (live + mock), handler.ts (update router), messages.ts (every word the bot says), dispatcher.ts (outbox -> Telegram), store.ts, config-core.ts
    workers/                   github.ts (scorer), ping.ts, verify.ts, templates.ts, auth.ts (cron bearer); net/ = the SSRF guard: ip.ts (deny-list), guard.ts (URL + DNS rules), fetch.ts (pinned fetch)
    leads/status.ts            what a recruiter may do with an unlock right now (mirrors the SQL rules)
    admin/                     guard.ts (is this user an admin?), access.ts (requireAdmin), queue.ts (what reviewers read), decisions.ts (what each form does), rubric.ts (validation), evidence.ts
    attestation/               contact.ts (normalise / mask / HMAC), token.ts, service.ts (the whole request flow), email.ts, mailer.ts + mail-config.ts
    supabase/admin.ts          the ONLY place the service-role key is used (payment routes)
    validation/                zod schemas + builders for create_talent_profile / create_recruiter_profile
  components/                  ConsentDialog, PhoneVerifier, LoginForm, onboarding forms, dashboard cards
  app/                         login · onboard/* · dashboard/talent · explore · auth/{callback,signout}
  app/api/                     admin/telegram-file (screenshot proxy) · payments/{create-order,verify} · webhooks/{razorpay,telegram} · cron/{dispatch,ping,github-score} · dev/mock-pay (mock mode only)
  app/admin/                   review-queue (list + [id] detail), talent/[id]; actions.ts = the forms' server actions
  app/verify/attestation       the page a CLIENT opens from the e-mailed link (no login) + done/
  app/explore/leads            "My leads": open WhatsApp, 👍 / 👎, 🚩 report no reply
  components/explore/          FiltersBar (Intent Gateway), TalentCard, TalentMap (Leaflet), UnlockFlow, PurchasePanel
```

#> **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# Decisions worth knowing

1. **`proxy.ts`, not `middleware.ts`.** Next 16 renamed it. Proxy only does cheap, cookie-based checks (the docs warn it also runs on link prefetches). "Incomplete profile → onboarding step" redirects live in the pages via `enforce()`, which can safely query the database.
2. **Consent is recorded from the browser**, not a Server Action. The database stores the caller's IP as DPDP evidence; a server-side call would store our server's IP.
3. **The service-role key is used only by platform code** (the read side of /admin, attestation creation, payments, bot, workers) (`src/lib/supabase/admin.ts`, `server-only`): the payment routes (`create_payment_order()` / `fulfill_payment()` are service-role only, which is what stops a recruiter granting themselves credits), the Telegram webhook and the three cron workers. Each of those is locked first: payments by Razorpay signatures and the user's session, the webhook by Telegram's secret header, the workers by `CRON_SECRET`, /admin by `requireAdmin()`. Everything else runs as the signed-in user under Row Level Security. *(Sprint 1 had no service key; the PRD planned these as Supabase Edge Functions. They are Next.js route handlers instead, which is simpler to run and test locally. They can move later without changing the database.)*
4. **The UI never sends a trusted number to the database.** Phone verification is decided by `sync_phone_verification()` from what Supabase Auth itself confirmed; the masked name is recomputed by the database.
5. **`cacheComponents` is off** (the scaffold enabled it). Every page here depends on the user, so there is nothing to cache yet.

#> **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# Production checklist for Auth (found while testing against the real stack)

- **Hosted Supabase → Authentication → Providers → Phone → turn ON "Enable phone confirmations".** If it is off,
  `updateUser({ phone })` marks the number verified *instantly, with no code*, and anyone could "verify" a number they don't own.
  Locally this is `[auth.sms] enable_confirmations = true` in `supabase/config.toml`; `npm run test:e2e` has a test that fails if it regresses.
- Add the production site URL to Authentication → URL Configuration → Redirect URLs (e.g. `https://devmap.in/**`).
- Paste the same email template (`supabase/templates/magic_link.html`) into Authentication → Email Templates → Magic Link, so the email carries both link and code.
- GitHub: leave the OAuth scopes at the default. No repository access is requested.

#> **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# Map & India's borders: read before launch

The map is Leaflet with clustered pins (a cluster glows green when someone inside is Online). Pins are **city centres**, never addresses.

**This is not yet legally "compliant".** The base-map tiles are third-party, and how they draw India's external boundary
(Jammu & Kashmir, Ladakh, Arunachal Pradesh) may not match Survey of India's official map. What the code does for you:
no labels from the base map (we label only our own cities), the view is locked to India, and the tile URL is an env var
(`NEXT_PUBLIC_MAP_TILE_URL`). Before public launch do **one** of these and have counsel review it:
(a) use a provider with an India-boundary "worldview" setting, or (b) drop the official outline into
`public/geo/india-official-boundary.geojson` (see `public/geo/README.txt`); the map draws it automatically.
Also check your tile provider's licence for commercial use. The default is Esri's keyless "Light Gray Base" (no labels or borders), for development only; CARTO's free tiles stopped working without an API key (they show an "API KEY REQUIRED" watermark), so don't use them without one.

#> **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# Payments (Razorpay)

| Step | What happens |
|---|---|
| 1 | Browser asks `POST /api/payments/create-order {bundleId}`. The **server** reads the price from `credit_bundles`, creates the Razorpay order, records it. An idempotency key makes retries return the same order. |
| 2 | Razorpay Checkout opens, restricted to UPI (UPI-intent sheet on mobile, QR on desktop; Razorpay chooses). |
| 3a | Browser callback → `POST /api/payments/verify`: checks Razorpay's signature (HMAC of `order\|payment` with the **key** secret) and the order's owner, then fulfils. |
| 3b | Razorpay → `POST /api/webhooks/razorpay`: checks `x-razorpay-signature` (HMAC of the **raw body** with the **webhook** secret) and that the amount equals the order, then fulfils. |
| 4 | `fulfill_payment()` is idempotent, so 3a and 3b racing, or Razorpay retrying, credits **once**. The UI polls the balance for up to 30 s. |

To go from mock to Razorpay **test mode**: create a Razorpay account, put `RAZORPAY_KEY_ID`/`KEY_SECRET` in `.env.local`, delete `RAZORPAY_MODE`, add a webhook
(`payment.captured`, `order.paid`) to `https://<public-url>/api/webhooks/razorpay` with its own secret (use a tunnel such as `cloudflared` locally).
**Not yet exercised against real Razorpay:** the Checkout widget itself (including the UPI-only `config` block) and live webhook delivery. Test both in Razorpay test mode before launch.

#> **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# Admin review screens (Sprint 4)

**Becoming an admin.** Admin = the Auth user's `app_metadata.role = "admin"`. Only the service key can write `app_metadata` (a user can edit their own `user_metadata`, which therefore grants nothing: tested against real Auth).

```bash
npx supabase status -o env   > **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# API_URL, SERVICE_ROLE_KEY
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/make-admin.mjs you@example.com     > **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# add --revoke to remove
```
They must **sign out and in** afterwards so their session carries the role; until then the database answers "forbidden" and the screen says so. Anyone else who opens `/admin/*` gets a 404.

**Two locks.** The page/action/route calls `requireAdmin()` (fresh check with the Auth server, repeated on *every* page and action because a layout isn't re-run on client-side navigation). The `admin_*` database functions then re-check the admin claim themselves. Decisions run **as the admin's own session**, so `reviewer_id` and `admin_audit_log` name a person; only the *reading* of the queues uses the service key.

| Queue | What the reviewer sees | Decisions |
|---|---|---|
| **Portfolios** (designers, marketers) | real name, portfolio links, projects; **not** phone/e-mail/chat id | four 0–10 rubric scores → work depth 0–40 + tier *reviewed* (+10) or *verified* (+20), or reject (records 0, reason required): `admin_set_talent_review` |
| **Ghost disputes** | recruiter's note, credits paid, WhatsApp-click and "Got it" times, the talent's note and **screenshot** (served through `/api/admin/telegram-file`, which keeps the bot token server-side and only serves file ids attached to a report) | uphold (refund exactly what was paid + strike) or reject: `admin_resolve_ghost_report` |
| **Strike 3 / bans** | the person's file and strikes | ban (blocklists phone + GitHub as hashes), *no ban* (suspension runs its course), or restore: `admin_ban_talent` / `admin_dismiss_ban_review` / `admin_restore_talent` |
| **Attestation spot-checks** | project, channel, masked client contact, how many confirmations that contact has given | approve, or reject = void the confirmation: `admin_review_attestation` |

`/admin/talent/<id>` is where a strike-appeal e-mail lands (the Telegram strike notice puts the id in the subject: "Strike Appeal <id>"; the address comes from `SUPPORT_EMAIL`). Every decision needs a written reason and goes into `admin_audit_log`. Designers and marketers now enter the portfolio queue automatically when they sign up (this was missing before).

#> **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# Client attestation (Sprint 4)

For work on a client's domain that the talent can't put a file on. In the dashboard, under an unverified project: **Built it for a client? Ask them to confirm**.

1. The talent enters the client's e-mail (or number). Checked before anything is sent: valid, **not the talent's own** (including Gmail dot/plus aliases), project is theirs (Row Level Security proves it) and not already verified.
2. We store only a **masked label** ("r***@acme.in") and a **keyed hash** of the contact, never the address. Limits in SQL: a client may confirm at most **2** projects per 30 days (checked when asking *and* when confirming), be asked at most 3 times a day; a project has at most 3 requests waiting; a talent sends at most 5 requests a day.
3. **E-mail** goes out from us through `SMTP_URL`. **WhatsApp** (we don't use the WhatsApp Business API) opens the talent's own WhatsApp with the message ready; because the talent carries that link, **every WhatsApp-channel confirmation goes to the admin spot-check queue** (e-mail ones: 10% random).
4. The client opens `/verify/attestation?token=…`: no account. **Opening the link changes nothing** (mail scanners pre-fetch links); the answer is a button press. The link works once and expires in 7 days. The token is 256-bit random and only its SHA-256 is stored.
5. *Yes* → the project is verified by attestation: **10** verification points (direct proof, 20, is still better and is never downgraded by a rejected spot-check).

Needs: `NEXT_PUBLIC_SITE_URL` (links in e-mails never come from the Host header), `ATTESTATION_HMAC_SECRET` (32+ chars; set once: changing it forgets the per-client limits), `SMTP_URL`, `MAIL_FROM`. Locally `SMTP_URL=smtp://127.0.0.1:54325` sends into Mailpit (http://127.0.0.1:54324; run `npx supabase stop && start` once after pulling this, since the SMTP port was newly exposed).

#> **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# Telegram bot & workers (Sprint 3)

**Why an outbox.** A bot message is queued (`telegram_outbox`) in the *same database transaction* as the event that caused it (an unlock, a ghost report, a strike). The dispatcher then claims rows (`FOR UPDATE SKIP LOCKED`, 2-minute lease), sends, and marks them sent only after Telegram accepts. If Telegram or our server is down the row simply waits and is retried (1, 4, 9, 16 minutes, then given up); nothing is lost and nothing is sent twice.

| Event | Message | Comes from |
|---|---|---|
| `/start <token>` | "Connected ✓" (the talent can now go Online) | webhook → `link_telegram()` |
| Recruiter unlocks | "New lead from a verified recruiter." + **Got it** | trigger on `lead_unlocks` → outbox → `acknowledge_lead()` on tap |
| Recruiter reports ghosting | notice with the 12-hour deadline; **reply to it** with a screenshot or note | trigger on `ghost_reports`; reply → `submit_ghost_dispute()` → manual review |
| Strike | explains strike 1 / 2 / 3 | trigger on `strikes` |
| Monday check-in | "Available for projects this week?" **Yes** | `enqueue_scheduled_notifications()` → `confirm_availability()` |
| Rank change | "You moved up: #5 → #3 among Karnataka developers." | same function, reads the `rank_moves` view |

Messages are plain text with no recruiter or contact details. Quiet hours (22:00–07:00 IST) hold back check-ins and rank changes; lead alerts, ghost reports and strike notices are exempt (a ghost report has a 12-hour clock that auto-upholds, so delaying it to the morning could cost someone a strike for sleeping).

**Going live with the bot**
1. @BotFather → `/newbot` → put `TELEGRAM_BOT_TOKEN` in `.env.local` / hosting env; delete `TELEGRAM_MODE`; set `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`.
2. `openssl rand -hex 24` → `TELEGRAM_WEBHOOK_SECRET`. 3. `npm run telegram:webhook -- set https://<public url>` (locally use a tunnel such as `cloudflared tunnel --url http://localhost:3000`).
4. Run the scheduler: `npm run workers`, or on Vercel add cron entries for `/api/cron/dispatch` (every minute; needs a plan that allows it), `/api/cron/ping` (`*/10 * * * *`), `/api/cron/github-score` (`*/15 * * * *`) with `CRON_SECRET` set, since Vercel sends it as the bearer token.
**Not yet tried against the real Telegram API:** sending, `setWebhook` and button taps (everything up to the HTTP call is tested with a fake; the mock mode exercises the full pipeline).

**GitHub scorer.** Per developer, daily: owned, non-fork repos pushed in the last 90 days; commits **authored by their account** on the default branch; ≤ 15 per day; repos need ≥ 2 active days; lockfile/README-only commits don't count. That last rule needs one API call per commit, so up to 40 commits are inspected at even spacing and their real-vs-trivial share is applied to the whole set (an account padded with README edits loses them; a normal one keeps nearly all). The count goes to `set_work_depth_from_commits()`; points = `min(40, round(8·ln(commits+1)))`. *Limits:* only repos the developer owns (organisation repos aren't counted); set `GITHUB_TOKEN` (no scopes) or the 60 requests/hour limit allows only a handful of developers per hour.

**Ownership verifier + pinger.** A project is verified when `https://<site>/devmap-verify.txt` contains `devmap-verify=<token>` or the talent's own GitHub repo names the site as its Homepage (`mark_project_verified()`, first talent to verify a URL wins). Only verified sites are pinged, ~4 times a day at random (each ping schedules the next one 3–9 hours out); up = a 2xx over valid TLS that isn't a starter-template page, with a second try before counting a failure. Seed profiles are never pinged or sent to GitHub.

**The SSRF guard** (`src/lib/workers/net/`): https only, no credentials or ports, no IP literals or internal-looking names; the name is resolved once (A + AAAA) and **every** answer must be public (deny-list covers RFC 1918, CGNAT, loopback, link-local/cloud-metadata, RFC 4193, multicast, documentation ranges, and IPv4 hidden in IPv4-mapped / NAT64 / 6to4 IPv6); the socket connects to that validated address while sending the original hostname for Host/SNI/certificate checks (so a second, rebinding DNS answer never gets used); one redirect at most, fully re-validated; 3.5 s, 1 MB, no cookies. Tested against a real local TLS server (pinning, redirects to private hosts, downgrade, size cap, timeout, wrong certificate name). *Deviation from the PRD:* the workers run inside the Next.js server with the service-role key, not under a dedicated "insert ping" database role; the guard is code-level. Moving the pinger to its own small service with a narrower role is the next hardening step.

**My leads** (`/explore/leads`): per unlock, *Open WhatsApp* (records the click), then 👍 Responsive / 👎 Not a fit; 🚩 *Report: no reply* appears 24 hours after the click and closes 7 days after the unlock (the screen mirrors the database rules and says when a button will unlock; the database re-checks every click).

#> **Heads-up (2026-11-04):** these notes were written during Sprints 1-4. Since then the **Telegram bot and SMS phone verification were removed** for the free beta (see `supabase/migrations/20261106000000_beta_simplify.sql`): talent are emailed instead, contact numbers are self-declared, and an unanswered ghost report goes to a person in the admin queue instead of being refunded automatically. Sections about Telegram, the outbox/dispatcher and phone OTP describe the old design.

# Known gaps (by design, later sprints)

- **Strike appeals are an e-mail to `SUPPORT_EMAIL` (default diadem.xeiver@gmail.com): someone has to own that mailbox.** The admin tool can act on it (`/admin/talent/<id>`) but there is no in-app appeal form.
- The admin tool is single-tier: any admin can do anything. No separate "reviewer" role, no two-person rule for bans (each action is audited).
- Designers/marketers can't re-apply after a rejection; the talent isn't told the reviewer's note anywhere except through the queue record (no UI for it yet).
- Attestation by WhatsApp depends on the talent actually sending the message; a client who gets e-mail is the stronger proof.
- Ghost-dispute screenshots need the real bot token to display (mock mode has no files), so that path is tested against a fake Telegram, not the real one.
- The map, the unlock dialogs, My leads, the admin forms and the dashboard's attestation form have been verified by build, types, server-rendered checks and no-JS form submissions, not by a person clicking in a browser: do a manual pass.
- Developers appear in discovery once the scorer has run for them (a developer with 0 qualifying commits and no verified project stays unlisted).
- `/terms` and `/privacy` are placeholders. A lawyer must write them (PRD §17). The attestation e-mail's promise ("we do not store your email address") is true today; keep it true or change the e-mail.
- Production SMS needs a provider and India DLT registration; until then use the test numbers.
