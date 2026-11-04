<div align="center">

# 🗺️ DevMap

**Hire verified local developers, designers and digital marketers, anywhere in India.**

Talent list themselves for free and are ranked on *proof of work*, not self-promotion.
Recruiters browse a live map, pay a small credit to unlock a contact, and talk directly on WhatsApp.
No chat to build. No commission. No middleman.

![Status](https://img.shields.io/badge/status-beta-orange)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e?logo=supabase&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss&logoColor=white)

</div>

---

## Why DevMap?

A small business in Surat that needs a website has two bad options: anonymous freelance platforms full of claims nobody can check, or word of mouth that doesn't scale. Meanwhile, talented people in Kochi, Silchar or Indore have no good way to *prove* their skill to someone who would hire them.

DevMap fixes both sides:

- **Proof over claims.** Rank comes from real GitHub activity, live projects that stay online, and reviewed portfolios. It can't be bought.
- **Local and in your language.** Filter by city, state and native language (all 22 scheduled languages), and see who is online *right now*.
- **Zero commission.** Recruiters pay only for the introduction and keep the whole project.
- **Private until paid.** Profiles show a masked name and generic project titles. The WhatsApp number is released only after an unlock.

## How it works

| | Talent (free) | Recruiter (pay per unlock) |
|---|---|---|
| 1 | Sign in: **GitHub** for developers (required), **email** for designers and marketers | Sign in with email |
| 2 | Add city, languages, skills, rate and live projects | Browse the map and list, or tap *"I need a website / app / ads"* |
| 3 | Prove ownership of a project (a file on the site, or GitHub activity) | See masked profiles, ranks and prices. **The first preview is free** |
| 4 | Switch **Online** when you're free (it switches itself off after 8 hours) | Buy credits by UPI, unlock, and **tap to open WhatsApp**. The talent is emailed |

## Features

- 🌍 **Animated globe landing page** with sample profiles; allow location and it zooms into India.
- 🗺️ **Split-screen explore view:** results on the left, a colour-coded map on the right.
- 📊 **Proof-based ranking:** work depth, live-site uptime and verification, with a Top-tier badge for active, high-scoring talent.
- 🔎 **Smart fallback:** if a city has nobody, the search widens to ~250 km, then to all of India (most work is remote), and *always tells you what it did*.
- 💳 **Razorpay UPI credit packs** (₹99 / ₹249 / ₹799, GST-inclusive). Test mode while in beta.
- 🛡️ **Privacy by design:** Row Level Security on every table, one protected function releases contact details, DPDP-style consent records, tombstone erasure.
- ✉️ **Email lead alerts:** a talent is emailed the moment a recruiter unlocks their contact. No chat bot, no SMS.
- 🟢 **Honest availability:** Online switches itself off after 8 hours, so the green dot can be trusted.
- ⚖️ **Legal pages:** Terms, Privacy, Refunds, Pricing and Contact.

## Tech stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Database and auth | Supabase (Postgres 17, Row Level Security, GitHub OAuth and email sign-in) |
| Payments | Razorpay (UPI), with a mock mode for local development |
| Maps | Leaflet + markercluster; WebGL globe with [cobe](https://github.com/shuding/cobe) |
| Tests | Vitest, SQL suites in Docker, contract tests against a real local Supabase |
| Hosting (beta) | Vercel (app) and Supabase cloud (database), both on free plans |

## Quick start (local)

**You need:** Node.js 20.9+, [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running), and Git.

```bash
git clone https://github.com/Xdiad47/DevMap-ai.git
cd DevMap-ai
npm install
bash scripts/dev-up.sh        # starts a local Supabase, writes .env.local, seeds 15 fake talents, runs the app
```

Open <http://localhost:3000>. Emails sent by the app land in a local inbox at <http://127.0.0.1:54324>.

Useful extras:

```bash
bash scripts/dev-up.sh --reset          # wipe the local database and start fresh
bash scripts/dev-admin.sh you@example.com   # make a local user an admin (sign out and in again)
```

> Everything in the seed data is fake: names, numbers and emails. Payments run in **mock mode** locally, so no real money moves and no Razorpay account is needed.

## Configuration and secrets

All configuration lives in environment variables. Copy [`.env.example`](.env.example) to `.env.local` and fill it in. `scripts/dev-up.sh` does this for you locally.

> **🔐 Never commit secrets.** `.env*` files are git-ignored (only `.env.example`, which holds no real values, is tracked).
> The Supabase **service-role key**, Razorpay **key secret**, `CRON_SECRET` and mail passwords are **server-only**: never prefix them with `NEXT_PUBLIC_`.
> If you ever paste a real key into a commit by accident, treat it as leaked: rotate it immediately, because deleting the commit does not un-publish it.

## Testing

```bash
npm test                    # unit tests (fast, no Docker)
npm run test:contract       # real Postgres + PostgREST via supabase-js (needs `supabase start`)
npm run test:e2e            # full flows against the real local Supabase
bash supabase/tests/run_tests.sh   # SQL behaviour suites in a throwaway Postgres container
npm run lint && npx tsc --noEmit
```

## Project layout

```
src/app/          pages and API routes (explore, dashboard, onboard, admin, legal pages, payments)
src/components/   UI: landing globe, explore map, filters, onboarding forms
src/lib/          domain logic: discovery/search, geo (states and cities), payments, validation, auth
supabase/         migrations (the schema and security rules), seed.sql, SQL tests
scripts/          local dev, smoke tests and admin helpers (workers: pinger + GitHub scorer)
docs/             engineering notes (architecture, decisions, security model)
```

Deeper notes: [docs/ENGINEERING.md](docs/ENGINEERING.md). Deployment: [DEPLOY.md](DEPLOY.md).

## Status and roadmap

DevMap is in **private beta**: real users are being onboarded and payments run in Razorpay *test* mode. Nothing here is a finished commercial service yet.

- [x] Talent onboarding, proof-based ranking, masked discovery
- [x] Credit packs and unlock with a refund path
- [x] Nationwide coverage: all states and union territories, 22 languages
- [ ] Real users and first paid unlocks
- [ ] Live payments, company details and legal review
- [ ] Production map provider and an official India boundary file

## Contributing and security

Issues and ideas are welcome. **Please report security problems by email, not in a public issue:** diadem.xeiver@gmail.com.

## Contact

Built by **Diadem**: diadem.xeiver@gmail.com

## License

No license has been chosen yet, so by default all rights are reserved. If you'd like to use or contribute to the code, please get in touch.
