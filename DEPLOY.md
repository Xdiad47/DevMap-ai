# Deploying DevMap for free (beta)

Plan: **Vercel** (website + API routes) → **Supabase** (database, login) → **your VPS** (only pokes the scheduler) → **Gmail** (email).
Everything below is free. Prices and limits change, so check each provider's pricing page before relying on them.

## 0. One-time: put the code on GitHub
The repo is public for now: https://github.com/Xdiad47/DevMap-ai. `.gitignore` already keeps `.env.local`, logs and the private PRD out.
```bash
cd /Volumes/D_Drive/DevMap.in
git add -A
git status                      # read the list: no .env.local, no keys
git diff --cached | grep -iE "secret|password|service_role|rzp_" # should only show variable NAMES, never values
git commit -m "DevMap beta"
git remote add origin https://github.com/Xdiad47/DevMap-ai.git
git push -u origin main         # if GitHub already has a README there, run `git pull --rebase origin main` first
```
Commits carry your git name and e-mail (`git config user.email`). On a public repo that e-mail is visible to everyone.

## 1. Database: Supabase cloud (free plan)
1. supabase.com → New project → region **Mumbai (ap-south-1)**. Save the database password.
2. **First enable the scheduler extension:** Database → Extensions → search `pg_cron` → switch it on. The migrations schedule the housekeeping jobs (Online switches off after 8 hours, rank snapshots, expired reports going to review, daily caps) only if this extension exists when you push. If you forget, enable it and re-run the `cron.schedule` block at the end of the first migration.
3. Push the schema (this does NOT load the fake seed profiles, which must never reach production):
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref from the project URL>
   npx supabase db push
   ```
4. Authentication → URL Configuration: Site URL `https://devmap.scanlyy.in`, Redirect URLs `https://devmap.scanlyy.in/**`.
5. Authentication → Providers: **Email** on, **GitHub** on (with your GitHub OAuth app), Google and Phone **off**. Developers sign in with GitHub; designers and marketers use the email code. Authentication → SMTP: use your Gmail App Password (section 5), because Supabase's built-in sender has a very low limit.
6. Project settings → API: copy the URL, the anon key and the service_role key (the last one is a secret).

## 2. Website: Vercel (Hobby plan)
Import the GitHub repo. Framework: Next.js (auto-detected). Add these environment variables (Production):

| Variable | Value |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY | from step 1.5 |
| SUPABASE_SERVICE_ROLE_KEY | from step 1.5 (secret) |
| NEXT_PUBLIC_SITE_URL | https://devmap.scanlyy.in |
| RAZORPAY_MODE | leave unset. Add RAZORPAY_KEY_ID / KEY_SECRET / WEBHOOK_SECRET (test keys) when you have them |
| CRON_SECRET, ATTESTATION_HMAC_SECRET | each: `openssl rand -hex 24`. Set once and keep |
| SMTP_URL, MAIL_FROM | see section 5 |
| SUPPORT_EMAIL | diadem.xeiver@gmail.com |
| GITHUB_TOKEN | a GitHub token with no scopes |
| NEXT_PUBLIC_MAP_TILE_URL, NEXT_PUBLIC_MAP_ATTRIBUTION | a production tile provider (the default Esri tiles are for development only) |

`RAZORPAY_MODE=mock` and `MAIL_MODE=mock` are refused by production builds on purpose. Until you add Razorpay test keys, buying credits will show an error; the free first preview still works.

## 3. DNS for scanlyy.in (GoDaddy)
Your zone already has `@`, `api` and `repopilot-api` pointing at the VPS (50.6.45.147), `www`, and email records. **Leave every one of them alone.** DevMap needs exactly one new record:

1. Vercel: Project → Settings → Domains → add `devmap.scanlyy.in`. Vercel shows the exact record it wants (normally `cname.vercel-dns.com`).
2. GoDaddy: Domains → scanlyy.in → DNS → **Add New Record**:

| Type | Name | Data | TTL |
|---|---|---|---|
| CNAME | `devmap` | the value Vercel shows (usually `cname.vercel-dns.com`) | 1 Hour |

3. Wait 5 to 30 minutes. Vercel then shows the domain as valid and issues HTTPS by itself.

Don't reuse the `api` name (it already serves Scanlyy). Supabase cloud and Gmail need no DNS records.

## 4. Scheduler (optional, almost no load on the VPS)
Vercel's free plan only allows cron jobs once a day, so something else has to knock on the door. The VPS only sends a tiny HTTP request; Vercel does the actual work, so the 2 GB server is not stressed. On the VPS, `crontab -e`:
```cron
CRON_SECRET=<same value as in Vercel>
*/10 * * * * curl -fsS -m 60 -H "Authorization: Bearer $CRON_SECRET" https://devmap.scanlyy.in/api/cron/ping       >/dev/null
*/15 * * * * curl -fsS -m 60 -H "Authorization: Bearer $CRON_SECRET" https://devmap.scanlyy.in/api/cron/github-score >/dev/null
```
That is two tiny HTTP calls. It adds almost no load to Scanlyy. (The other housekeeping jobs run inside Supabase itself, via `pg_cron`.)

## 5. Email: Gmail (free, no DNS)
1. Google Account → Security → turn on 2-Step Verification → App passwords → create one named "DevMap" (16 characters).
2. In Vercel:
   - `SMTP_URL=smtps://diadem.xeiver%40gmail.com:<app password without spaces>@smtp.gmail.com:465`
   - `MAIL_FROM="DevMap <diadem.xeiver@gmail.com>"`
3. Gmail caps sending (a few hundred a day on a personal account), which is plenty for a beta. When you grow, move to a transactional provider and add SPF/DKIM records to your domain.

## 6. First admin
After you have signed up once on the live site, from your own computer:
```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> node scripts/make-admin.mjs diadem.xeiver@gmail.com
```
Sign out and in again. Never put the service role key anywhere public.

## 7. Before you show anyone
- [ ] Production database has **no** seed profiles (`select count(*) from talent_public` is only real people).
- [ ] Signed up and tested as talent and as recruiter with two different emails.
- [ ] Payments work in Razorpay **test** mode (no real money moves).
- [ ] Legal pages show your real company details, or the placeholders you accept for the beta.
- [ ] Friends invited and onboarded (see below).

## 8. What stops being free
- Vercel Hobby is for non-commercial use. Once you charge real money, move to a paid plan or another host.
- Supabase free projects pause after about a week of no use, and have size limits. Keep the 1-minute scheduler running (it keeps the project awake) and move to a paid plan when real revenue starts.
- Razorpay charges a per-transaction fee only on live payments (check the current rate).
- There is no SMS and no Telegram in the beta, so nothing here costs per message. Contact numbers are self-declared; recruiters can report an unanswered lead, and you review reports by hand in /admin.
