-- =====================================================================
-- DevMap.in  |  Supabase migration  |  PRD v2.1
-- File: supabase/migrations/20261102000000_devmap_v2_1_init.sql
--
-- Design rules enforced here (see PRD_v2.1.md):
--   1. RLS is ENABLED on every table. Clients get the minimum column/row access.
--      Anything touching money, contact data, scores or moderation is written
--      ONLY by SECURITY DEFINER functions or the service_role key.
--   2. Contact data lives in talent_private and leaves it ONLY through
--      public.unlock_talent_contact() (atomic, idempotent).
--   3. All money is bigint PAISE. Credits are integers (1 credit = 1 standard unlock).
--   4. Financial / consent rows are never cascade-deleted. Erasure = anonymise.
--   5. Internal helpers live in schema "private" (not exposed by the Supabase API).
--
-- Run order inside this file: setup -> enums -> config/helpers -> tables ->
-- internal functions -> triggers -> public RPCs -> service/admin functions ->
-- jobs -> RLS + grants -> seeds -> cron.
-- The Supabase CLI wraps each migration file in a transaction.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. SETUP: extensions, private schema, lock down default privileges
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Supabase grants ALL on new public objects to anon/authenticated by default.
-- Reverse that so nothing is reachable unless we grant it explicitly below.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------
create type public.role_type           as enum ('developer', 'designer', 'marketer');
create type public.review_tier         as enum ('unverified', 'reviewed', 'verified');
create type public.unlock_tier         as enum ('standard', 'top_tier');
create type public.verification_method as enum ('none', 'github_homepage', 'well_known_file', 'client_attestation');


-- ---------------------------------------------------------------------
-- 2. CONFIG + PURE HELPERS
-- ---------------------------------------------------------------------
create table public.app_config (
  key        text primary key,
  value_int  int  not null,
  note       text
);

create function private.cfg(p_key text) returns int
language sql stable security definer set search_path = public, pg_temp as
$$ select value_int from public.app_config where key = p_key $$;

create function private.digits(p_val text) returns text
language sql immutable as
$$ select regexp_replace(coalesce(p_val, ''), '\D', '', 'g') $$;

create function private.hash_value(p_val text) returns text
language sql immutable set search_path = public, extensions, pg_temp as
$$ select encode(extensions.digest(lower(btrim(coalesce(p_val, ''))), 'sha256'), 'hex') $$;

-- "Rahul Sharma" -> "Rahul S."   |  "Rahul" -> "Rahul"
create function private.mask_name(p_full text) returns text
language sql immutable as
$$
  select case
    when n = 0 then 'Talent'
    when n = 1 then initcap(parts[1])
    else initcap(parts[1]) || ' ' || upper(left(parts[n], 1)) || '.'
  end
  from (
    select regexp_split_to_array(btrim(coalesce(p_full, '')), '\s+') as parts,
           cardinality(regexp_split_to_array(btrim(coalesce(p_full, '')), '\s+')) as n
  ) s
$$;

-- Developer work-depth points: min(40, round(8 * ln(commits + 1)))
create function private.commit_points(p_commits int) returns int
language sql immutable as
$$ select least(40, round(8 * ln((greatest(coalesce(p_commits, 0), 0) + 1)::numeric)))::int $$;

create function private.tier_for(p_score numeric, p_last_active timestamptz) returns public.unlock_tier
language sql stable as
$$
  select case
    when p_score >= private.cfg('tier1_min_score')
     and p_last_active >= now() - make_interval(days => private.cfg('tier1_active_days'))
    then 'top_tier'::public.unlock_tier
    else 'standard'::public.unlock_tier
  end
$$;

-- Admin = service_role key OR a user whose JWT app_metadata.role = 'admin'
create function private.is_admin() returns boolean
language sql stable as
$$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
      or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;


-- ---------------------------------------------------------------------
-- 3. TABLES
-- ---------------------------------------------------------------------

-- 3.1 Skill catalogue (public read). talent_public.skills holds slugs from here.
create table public.skills (
  slug       text primary key check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  label      text not null,
  role       public.role_type not null,
  category   text not null,
  sort_order int  not null default 0
);

-- 3.2 Map-safe public directory (anon can read listed rows only; see RLS)
create table public.talent_public (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid unique references auth.users(id) on delete set null,
  role                    public.role_type not null,
  masked_name             text not null,                      -- "Rahul S."
  city                    text not null,
  state                   text not null,
  -- CITY-CENTROID coordinates only (never a home address); used for map clustering
  latitude                numeric(9,6) check (latitude  between 6  and 38),
  longitude               numeric(9,6) check (longitude between 68 and 98),
  location_changed_at     timestamptz,
  native_language         text not null,
  secondary_languages     text[] not null default '{}',
  skills                  text[] not null default '{}' check (cardinality(skills) <= 12),
  hourly_rate_paise       bigint not null check (hourly_rate_paise >= 30000),   -- >= Rs 300/hr
  is_online               boolean not null default false,
  online_since            timestamptz,
  is_paused               boolean not null default false,
  is_at_daily_cap         boolean not null default false,
  is_pro                  boolean not null default false,     -- badge only; payment gate hidden in v1
  review_status           public.review_tier not null default 'unverified',
  proof_score             int not null default 0 check (proof_score between 0 and 100),
  response_velocity_score int not null default 70 check (response_velocity_score between 0 and 100),
  composite_rank_score    numeric(5,2) generated always as
                            ((proof_score * 0.80 + response_velocity_score * 0.20)::numeric(5,2)) stored,
  score_breakdown         jsonb not null default '{}'::jsonb,
  -- rank tie-breakers (maintained by recompute_proof) + current rank (take_rank_snapshot)
  verified_live_apps      int not null default 0,
  uptime_30d_avg          numeric(5,2) not null default 0,
  last_proof_activity_at  timestamptz,
  state_rank              int,
  state_cohort_size       int,
  -- listing gate, maintained by trigger: phone verified AND (proof_score > 0 OR reviewed)
  is_listed               boolean not null default false,
  suspended_until         timestamptz,
  is_banned               boolean not null default false,
  last_active_at          timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  deleted_at              timestamptz                          -- tombstone marker (erasure)
);
create index talent_public_skills_gin     on public.talent_public using gin (skills);
create index talent_public_langs_gin      on public.talent_public using gin (secondary_languages);
create index talent_public_browse_idx     on public.talent_public (state, role, composite_rank_score desc) where is_listed;
create index talent_public_online_idx     on public.talent_public (state, role) where is_listed and is_online;

-- 3.3 Locked contact vault: NEVER exposed to clients except the owner
create table public.talent_private (
  talent_id         uuid primary key references public.talent_public(id) on delete cascade,
  full_name         text not null,
  phone_e164        text not null unique check (phone_e164      ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_number   text not null check (whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'),
  telegram_handle   text check (telegram_handle ~ '^@?[A-Za-z0-9_]{5,32}$'),
  telegram_chat_id  bigint unique,                              -- set by bot /start deep-link
  email             text not null,
  github_user_id    text unique,                                -- one GitHub account = one profile
  github_username   text,
  portfolio_links   jsonb not null default '[]'::jsonb check (jsonb_typeof(portfolio_links) = 'array'),
  is_phone_verified boolean not null default false,
  daily_unlock_cap  int  not null default 5 check (daily_unlock_cap between 1 and 20),
  unlocks_today     int  not null default 0,
  cap_date          date not null default ((now() at time zone 'Asia/Kolkata')::date)
);

-- 3.4 Projects + ownership proof
create table public.projects (
  id                  uuid primary key default gen_random_uuid(),
  talent_id           uuid not null references public.talent_public(id) on delete cascade,
  generic_title       text not null check (char_length(generic_title) between 3 and 80),
  -- https only, no credentials, no custom port (SSRF rule; worker re-validates)
  live_url            text not null check (live_url ~ '^https://[^/\s:@]+(/[^\s]*)?$'),
  repo_url            text check (repo_url is null or repo_url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?$'),
  verification_token  text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  verification_method public.verification_method not null default 'none',
  is_ownership_verified boolean not null default false,
  verified_at         timestamptz,
  uptime_30d          numeric(5,2) not null default 0,
  samples_30d         int not null default 0,
  is_up               boolean,
  last_http_status    int,
  last_checked_at     timestamptz,
  created_at          timestamptz not null default now(),
  unique (talent_id, live_url)
);
-- A URL can be DIRECTLY verified by only one talent (first wins)
create unique index projects_direct_verified_url_uniq
  on public.projects (lower(live_url))
  where is_ownership_verified and verification_method in ('github_homepage', 'well_known_file');

create table public.ping_results (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  http_status int,
  latency_ms  int,
  is_up       boolean not null,
  error       text,
  checked_at  timestamptz not null default now()
);
create index ping_results_project_time_idx on public.ping_results (project_id, checked_at desc);

-- 3.5 Client attestation (for work on client-owned domains / private repos)
create table public.client_attestations (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  channel        text not null check (channel in ('email', 'whatsapp')),
  contact_masked text not null,               -- "r***@acme.in" (we never store the raw contact)
  contact_hmac   text not null,               -- HMAC(server secret, contact) for abuse limits
  token_hash     text not null unique,        -- sha256 of the link token
  status         text not null default 'pending' check (status in ('pending','confirmed','declined','expired')),
  expires_at     timestamptz not null default now() + interval '7 days',
  responded_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index client_attestations_hmac_idx on public.client_attestations (contact_hmac, created_at);

-- 3.6 Recruiters
create table public.recruiters (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid unique references auth.users(id) on delete set null,
  phone_e164              text not null unique,
  is_phone_verified       boolean not null default false,
  company_name            text,
  gstin                   text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  credits_balance         int not null default 0 check (credits_balance >= 0),
  trial_unlocks_remaining int not null default 0 check (trial_unlocks_remaining >= 0),
  trial_granted_at        timestamptz,
  created_at              timestamptz not null default now(),
  deleted_at              timestamptz
);

-- 3.7 Credits ledger: append-only, one row per balance change
create table public.credits_ledger (
  id            uuid primary key default gen_random_uuid(),
  recruiter_id  uuid not null references public.recruiters(id) on delete restrict,
  delta         int  not null,
  balance_after int  not null check (balance_after >= 0),
  reason        text not null check (reason in
                  ('purchase','unlock_standard','unlock_top','unlock_trial','trial_grant','ghost_refund','admin_adjustment')),
  reference_id  uuid,
  created_at    timestamptz not null default now()
);
-- Idempotency: the same (reason, reference) can never be applied twice
create unique index credits_ledger_ref_uniq on public.credits_ledger (reason, reference_id) where reference_id is not null;
create index credits_ledger_recruiter_idx on public.credits_ledger (recruiter_id, created_at desc);

-- 3.8 Bundles + payments (paise)
create table public.credit_bundles (
  id          text primary key,
  label       text not null,
  credits     int  not null check (credits > 0),
  price_paise bigint not null check (price_paise > 0),      -- GST-INCLUSIVE price
  is_active   boolean not null default true,
  sort_order  int not null default 0
);

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  recruiter_id        uuid not null references public.recruiters(id) on delete restrict,
  bundle_id           text not null references public.credit_bundles(id),
  credits_granted     int  not null check (credits_granted > 0),
  amount_paise        bigint not null check (amount_paise > 0),
  gst_included_paise  bigint not null default 0 check (gst_included_paise >= 0),
  idempotency_key     text not null unique,
  razorpay_order_id   text not null unique,
  razorpay_payment_id text unique,
  status              text not null default 'created' check (status in ('created','captured','failed','refunded')),
  invoice_url         text,
  created_at          timestamptz not null default now(),
  captured_at         timestamptz
);

-- 3.9 Lead unlocks
create table public.lead_unlocks (
  id                      uuid primary key default gen_random_uuid(),
  recruiter_id            uuid not null references public.recruiters(id)    on delete restrict,
  talent_id               uuid not null references public.talent_public(id) on delete restrict,
  tier_at_unlock          public.unlock_tier not null,
  credits_deducted        int  not null check (credits_deducted >= 0),
  is_trial                boolean not null default false,
  talent_online_at_unlock boolean not null,                 -- only these leads affect response velocity
  talent_notified_at      timestamptz,
  talent_acknowledged_at  timestamptz,
  has_clicked_whatsapp    boolean not null default false,
  whatsapp_clicked_at     timestamptz,
  refunded_at             timestamptz,
  created_at              timestamptz not null default now(),
  constraint unique_recruiter_talent_unlock unique (recruiter_id, talent_id)
);
create index lead_unlocks_talent_idx on public.lead_unlocks (talent_id, created_at desc);

-- 3.10 Recruiter feedback (thumbs-up / not-a-fit). Ghost reports are separate.
create table public.lead_feedback (
  id           uuid primary key default gen_random_uuid(),
  unlock_id    uuid not null unique references public.lead_unlocks(id) on delete restrict,
  recruiter_id uuid not null references public.recruiters(id)    on delete restrict,
  talent_id    uuid not null references public.talent_public(id) on delete restrict,
  rating       text not null check (rating in ('responsive', 'not_fit')),
  created_at   timestamptz not null default now()
);

-- 3.11 Ghost reports + strikes
create table public.ghost_reports (
  id                  uuid primary key default gen_random_uuid(),
  unlock_id           uuid not null unique references public.lead_unlocks(id) on delete restrict,
  recruiter_id        uuid not null references public.recruiters(id)    on delete restrict,
  talent_id           uuid not null references public.talent_public(id) on delete restrict,
  recruiter_note      text,
  talent_dispute_note text,
  evidence_urls       text[] not null default '{}',
  status              text not null default 'awaiting_talent'
                        check (status in ('awaiting_talent','under_review','upheld','rejected')),
  talent_deadline     timestamptz not null,
  resolution_notes    text,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz
);
create index ghost_reports_open_idx on public.ghost_reports (talent_deadline) where status = 'awaiting_talent';

create table public.strikes (
  id         uuid primary key default gen_random_uuid(),
  talent_id  uuid not null references public.talent_public(id) on delete restrict,
  report_id  uuid not null unique references public.ghost_reports(id) on delete restrict,
  status     text not null default 'active' check (status in ('active', 'overturned')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index strikes_talent_idx on public.strikes (talent_id, expires_at);

-- 3.12 Rank history (powers "you moved #3 -> #5" alerts)
create table public.rank_snapshots (
  id            uuid primary key default gen_random_uuid(),
  talent_id     uuid not null references public.talent_public(id) on delete cascade,
  role          public.role_type not null,
  state         text not null,
  rank          int  not null,
  cohort_size   int  not null,
  score         numeric(5,2) not null,
  recorded_on   date not null default ((now() at time zone 'Asia/Kolkata')::date),
  unique (talent_id, recorded_on)
);

-- 3.13 Manual review queue (designer/marketer portfolios, ghost disputes, ban reviews)
create table public.review_queue (
  id             uuid primary key default gen_random_uuid(),
  talent_id      uuid references public.talent_public(id) on delete set null,
  type           text not null check (type in
                   ('designer_portfolio','marketer_portfolio','attestation_spotcheck','ghost_dispute','ban_review')),
  related_id     uuid,
  evidence_urls  text[] not null default '{}',
  status         text not null default 'pending' check (status in ('pending','in_review','approved','rejected')),
  reviewer_notes text,
  reviewer_id    uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);
create index review_queue_open_idx on public.review_queue (type, created_at) where status in ('pending', 'in_review');

-- 3.14 DPDP consents (retained 7 years; anonymised, never deleted, on erasure)
create table public.consents (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete set null,
  subject_ref    uuid,                       -- pseudonymous tombstone id kept after erasure
  consent_type   text not null check (consent_type in
                   ('dpdp_directory_listing','contact_disclosure','phone_processing','recruiter_terms','telegram_notifications')),
  policy_version text not null,
  ip_address     inet,
  user_agent     text,
  consented_at   timestamptz not null default now(),
  withdrawn_at   timestamptz,
  erased_at      timestamptz
);
create index consents_user_idx on public.consents (user_id, consent_type);

-- 3.15 Abuse blocklist (hashes only) + Telegram link tokens
create table public.blocklist (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('phone', 'github')),
  value_hash text not null,
  reason     text,
  created_at timestamptz not null default now(),
  unique (kind, value_hash)
);

create table public.telegram_link_tokens (
  token_hash text primary key,
  talent_id  uuid not null references public.talent_public(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);


-- ---------------------------------------------------------------------
-- 4. INTERNAL FUNCTIONS (schema private) + TRIGGERS
-- ---------------------------------------------------------------------

-- 4.1 talent_public guard: listing gate, skills validation, online rules
create function private.tg_talent_public_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_verified boolean;
  v_tg       bigint;
begin
  if TG_OP = 'INSERT' or NEW.skills is distinct from OLD.skills then
    NEW.skills := coalesce((select array_agg(distinct s order by s) from unnest(NEW.skills) s), '{}');
    if exists (select 1 from unnest(NEW.skills) s(slug) left join public.skills k on k.slug = s.slug where k.slug is null) then
      raise exception 'unknown_skill';
    end if;
  end if;

  select p.is_phone_verified, p.telegram_chat_id into v_verified, v_tg
  from public.talent_private p where p.talent_id = NEW.id;

  -- LISTING GATE: phone verified AND (proof_score > 0 OR reviewed)
  NEW.is_listed := coalesce(v_verified, false)
                   and (NEW.proof_score > 0 or NEW.review_status = 'reviewed')
                   and NEW.deleted_at is null;

  if NEW.is_paused or NEW.is_banned or NEW.deleted_at is not null
     or (NEW.suspended_until is not null and NEW.suspended_until > now()) then
    NEW.is_online := false;
  end if;

  if NEW.is_online and (TG_OP = 'INSERT' or not OLD.is_online) then
    if v_tg is null then raise exception 'telegram_link_required'; end if;   -- bot must be able to reach them
    NEW.online_since   := now();
    NEW.last_active_at := now();
  elsif not NEW.is_online then
    NEW.online_since := null;
  end if;

  -- any owner-initiated edit counts as activity
  if TG_OP = 'UPDATE' and NEW.user_id is not null and NEW.user_id = auth.uid() then
    NEW.last_active_at := now();
  end if;
  return NEW;
end $$;

create trigger talent_public_guard
  before insert or update on public.talent_public
  for each row execute function private.tg_talent_public_guard();

-- re-evaluate the listing gate whenever phone verification changes
create function private.tg_talent_private_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.talent_public set is_listed = is_listed where id = NEW.talent_id;   -- fires guard
  return NEW;
end $$;

create trigger talent_private_sync
  after insert or update of is_phone_verified on public.talent_private
  for each row execute function private.tg_talent_private_sync();

-- 4.2 Append-only ledger
create function private.tg_ledger_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'credits_ledger is append-only';
end $$;

create trigger credits_ledger_no_update before update or delete on public.credits_ledger
  for each row execute function private.tg_ledger_append_only();

-- 4.3 The ONLY way credits move. Locks the recruiter row; ledger + balance stay consistent.
create function private.apply_credit_delta(p_recruiter uuid, p_delta int, p_reason text, p_ref uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_balance int;
begin
  select credits_balance into v_balance from public.recruiters where id = p_recruiter for update;
  if not found then raise exception 'recruiter_not_found'; end if;
  if v_balance + p_delta < 0 then raise exception 'insufficient_credits'; end if;
  update public.recruiters set credits_balance = v_balance + p_delta where id = p_recruiter;
  insert into public.credits_ledger (recruiter_id, delta, balance_after, reason, reference_id)
  values (p_recruiter, p_delta, v_balance + p_delta, p_reason, p_ref);
  return v_balance + p_delta;
end $$;

-- 4.4 Uptime from the last 30 days of pings
create function private.recompute_project_uptime(p_project uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  with agg as (
    select count(*) as n,
           round(100.0 * count(*) filter (where is_up) / nullif(count(*), 0), 2) as pct
    from public.ping_results
    where project_id = p_project and checked_at >= now() - interval '30 days'
  ), last_ping as (
    select is_up, http_status, checked_at
    from public.ping_results where project_id = p_project
    order by checked_at desc limit 1
  )
  update public.projects p set
    uptime_30d       = coalesce(agg.pct, 0),
    samples_30d      = agg.n,
    is_up            = last_ping.is_up,
    last_http_status = last_ping.http_status,
    last_checked_at  = last_ping.checked_at
  from agg left join last_ping on true
  where p.id = p_project;
end $$;

create function private.tg_ping_after_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.recompute_project_uptime(NEW.project_id);
  return NEW;
end $$;

create trigger ping_results_after_insert after insert on public.ping_results
  for each row execute function private.tg_ping_after_insert();

-- 4.5 Proof score (0-100) = work depth (<=40) + live proof (<=40) + verification (<=20)
create function private.recompute_proof(p_talent uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tp     public.talent_public%rowtype;
  v_work   int;
  v_live   numeric := 0;
  v_verif  int := 0;
  v_apps   int;
  v_avg    numeric;
  v_direct boolean;
  v_attest boolean;
begin
  select * into v_tp from public.talent_public where id = p_talent and deleted_at is null for update;
  if not found then return; end if;

  -- A. work depth: dev = log commits (set by worker); designer/marketer = reviewer rubric (0-40)
  v_work := least(40, greatest(0, coalesce((v_tp.score_breakdown ->> 'work_depth')::int, 0)));

  -- B. live proof: best 2 ownership-verified projects, 20 pts each.
  --    20 * clamp((uptime-80)/15, 0, 1) * min(1, samples/28)   (28 = 7 days at 4 pings/day)
  select coalesce(sum(s.pts), 0) into v_live from (
    select 20 * least(1, greatest(0, (pr.uptime_30d - 80) / 15.0)) * least(1, pr.samples_30d / 28.0) as pts
    from public.projects pr
    where pr.talent_id = p_talent and pr.is_ownership_verified
    order by pr.uptime_30d desc, pr.samples_30d desc
    limit 2
  ) s;

  select count(*) filter (where pr.is_up),
         coalesce(avg(pr.uptime_30d), 0),
         bool_or(pr.verification_method in ('github_homepage', 'well_known_file')),
         bool_or(pr.verification_method = 'client_attestation')
    into v_apps, v_avg, v_direct, v_attest
  from public.projects pr
  where pr.talent_id = p_talent and pr.is_ownership_verified;

  -- C. verification confidence: direct proof 20 / client attestation 10 / reviewer tier 10-20
  v_verif := greatest(
    case when coalesce(v_direct, false) then 20 when coalesce(v_attest, false) then 10 else 0 end,
    case v_tp.review_status when 'verified' then 20 when 'reviewed' then 10 else 0 end
  );

  update public.talent_public set
    proof_score        = least(100, v_work + round(v_live)::int + v_verif),
    verified_live_apps = coalesce(v_apps, 0),
    uptime_30d_avg     = round(coalesce(v_avg, 0), 2),
    score_breakdown    = score_breakdown || jsonb_build_object(
                           'work_depth', v_work, 'live_proof', round(v_live, 1),
                           'verification', v_verif, 'recomputed_at', now())
  where id = p_talent;
end $$;

create function private.tg_projects_rescore() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.recompute_proof(case when TG_OP = 'DELETE' then OLD.talent_id else NEW.talent_id end);
  return null;
end $$;

create trigger projects_rescore
  after insert or delete or update of is_ownership_verified, verification_method, uptime_30d, samples_30d, is_up
  on public.projects
  for each row execute function private.tg_projects_rescore();

-- 4.6 Response velocity (0-100) = lead-acknowledgement speed (+ feedback bonus - strike penalty)
--     Only leads delivered while talent was ONLINE count (no sleeper penalty).
create function private.recompute_response_velocity(p_talent uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n     int;
  v_med   numeric;
  v_base  numeric;
  v_bonus int;
  v_pen   int;
  v_score int;
begin
  select count(*), percentile_cont(0.5) within group (order by a.pts)
    into v_n, v_med
  from (
    select case
             when u.talent_acknowledged_at is null                                  then 0
             when u.talent_acknowledged_at - u.created_at <= interval '15 minutes'  then 100
             when u.talent_acknowledged_at - u.created_at <= interval '60 minutes'  then 80
             when u.talent_acknowledged_at - u.created_at <= interval '4 hours'     then 50
             else 0
           end as pts
    from public.lead_unlocks u
    where u.talent_id = p_talent
      and u.talent_online_at_unlock
      and u.created_at >= now() - interval '90 days'
      and (u.talent_acknowledged_at is not null or u.created_at < now() - interval '4 hours')  -- window closed
  ) a;

  -- fewer than 3 samples: blend toward the neutral 70
  v_base := (coalesce(v_med, 70) * least(v_n, 3) + 70 * greatest(3 - v_n, 0)) / 3.0;

  -- +5 per distinct recruiter who paid and clicked thumbs-up, capped at +20
  select least(20, 5 * count(distinct f.recruiter_id)) into v_bonus
  from public.lead_feedback f
  join public.lead_unlocks u on u.id = f.unlock_id
  where f.talent_id = p_talent and f.rating = 'responsive' and not u.is_trial
    and f.created_at >= now() - interval '90 days';

  select 20 * count(*) into v_pen
  from public.strikes where talent_id = p_talent and status = 'active' and expires_at > now();

  v_score := greatest(0, least(100, round(v_base + coalesce(v_bonus, 0) - coalesce(v_pen, 0))));

  update public.talent_public set
    response_velocity_score = v_score,
    score_breakdown = score_breakdown || jsonb_build_object(
                        'response_velocity', v_score, 'ack_median', v_med, 'ack_samples', v_n,
                        'feedback_bonus', coalesce(v_bonus, 0), 'strike_penalty', coalesce(v_pen, 0))
  where id = p_talent and deleted_at is null;
end $$;

-- 4.7 Strikes: 1 = warning (bot), 2 = 14-day suspension, 3 = suspension + manual ban review
create function private.apply_strike(p_talent uuid, p_report uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  insert into public.strikes (talent_id, report_id, expires_at)
  values (p_talent, p_report, now() + make_interval(days => private.cfg('strike_expiry_days')));

  select count(*) into v_n from public.strikes
  where talent_id = p_talent and status = 'active' and expires_at > now();

  if v_n >= 2 then
    update public.talent_public
       set suspended_until = now() + make_interval(days => private.cfg('strike2_suspension_days')),
           is_online = false
     where id = p_talent;
  end if;

  if v_n >= 3 and not exists (
       select 1 from public.review_queue
       where talent_id = p_talent and type = 'ban_review' and status in ('pending', 'in_review')) then
    insert into public.review_queue (talent_id, type, related_id) values (p_talent, 'ban_review', p_report);
  end if;
end $$;

-- 4.8 Uphold a ghost report: refund exactly what was paid, add a strike
create function private.uphold_ghost_report(p_report uuid, p_notes text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_r public.ghost_reports%rowtype;
  v_u public.lead_unlocks%rowtype;
begin
  select * into v_r from public.ghost_reports where id = p_report for update;
  if not found or v_r.status in ('upheld', 'rejected') then return; end if;
  select * into v_u from public.lead_unlocks where id = v_r.unlock_id for update;

  update public.ghost_reports set status = 'upheld', resolved_at = now(), resolution_notes = p_notes where id = p_report;

  if v_u.refunded_at is null and v_u.credits_deducted > 0 and not v_u.is_trial then
    perform private.apply_credit_delta(v_u.recruiter_id, v_u.credits_deducted, 'ghost_refund', v_u.id);
    update public.lead_unlocks set refunded_at = now() where id = v_u.id;
  end if;

  perform private.apply_strike(v_r.talent_id, v_r.id);
  perform private.recompute_response_velocity(v_r.talent_id);
end $$;

-- 4.9 What a recruiter receives after unlock: exactly these four fields, nothing else
create function private.contact_payload(p_talent uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  select jsonb_build_object(
           'full_name',       p.full_name,
           'whatsapp_number', p.whatsapp_number,
           'telegram_handle', p.telegram_handle,
           'portfolio_links', coalesce(p.portfolio_links, '[]'::jsonb) ||
                              coalesce((select jsonb_agg(pr.live_url order by pr.created_at)
                                        from public.projects pr
                                        where pr.talent_id = p.talent_id and pr.is_ownership_verified), '[]'::jsonb))
    into v
  from public.talent_private p
  join public.talent_public t on t.id = p.talent_id
  where p.talent_id = p_talent and t.deleted_at is null and not t.is_banned;
  if v is null then raise exception 'talent_unavailable'; end if;
  return v;
end $$;

create function private.has_consents(p_uid uuid, p_types text[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$
  select (select count(distinct c.consent_type) from public.consents c
          where c.user_id = p_uid and c.consent_type = any (p_types) and c.withdrawn_at is null)
         = cardinality(p_types)
$$;

-- 4.10 Phone verification: trusts Supabase Auth's confirmed phone (OTP), never client input
create function private.sync_phone_verification(p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_auth_digits text;
  v_t   boolean;
  v_rid uuid;
  v_rv  boolean;
  v_rtg timestamptz;
begin
  select private.digits(u.phone) into v_auth_digits
  from auth.users u
  where u.id = p_uid and u.phone_confirmed_at is not null and coalesce(u.phone, '') <> '';

  update public.talent_private tp
     set is_phone_verified = coalesce(private.digits(tp.phone_e164) = v_auth_digits, false)
    from public.talent_public t
   where t.id = tp.talent_id and t.user_id = p_uid
  returning tp.is_phone_verified into v_t;

  update public.recruiters r
     set is_phone_verified = coalesce(private.digits(r.phone_e164) = v_auth_digits, false)
   where r.user_id = p_uid and r.deleted_at is null
  returning r.id, r.is_phone_verified, r.trial_granted_at into v_rid, v_rv, v_rtg;

  -- one free preview, granted once, only after the phone is verified
  if coalesce(v_rv, false) and v_rtg is null then
    update public.recruiters set trial_unlocks_remaining = 1, trial_granted_at = now() where id = v_rid;
    perform private.apply_credit_delta(v_rid, 0, 'trial_grant', v_rid);
  end if;

  return jsonb_build_object('talent_verified', coalesce(v_t, false), 'recruiter_verified', coalesce(v_rv, false));
end $$;


-- ---------------------------------------------------------------------
-- 5. PUBLIC RPCs (called by signed-in users via supabase.rpc)
-- ---------------------------------------------------------------------

-- 5.1 Consent
create function public.record_consent(p_type text, p_policy_version text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_ip inet; v_ua text; v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  begin
    v_ip := nullif(btrim(split_part(coalesce((current_setting('request.headers', true))::json ->> 'x-forwarded-for', ''), ',', 1)), '')::inet;
  exception when others then v_ip := null;
  end;
  begin
    v_ua := (current_setting('request.headers', true))::json ->> 'user-agent';
  exception when others then v_ua := null;
  end;
  insert into public.consents (user_id, consent_type, policy_version, ip_address, user_agent)
  values (v_uid, p_type, p_policy_version, v_ip, v_ua)
  returning id into v_id;
  return v_id;
end $$;

-- Withdrawing listing/disclosure consent hides the profile immediately
create function public.withdraw_consent(p_type text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.consents set withdrawn_at = now()
   where user_id = v_uid and consent_type = p_type and withdrawn_at is null;
  if p_type in ('dpdp_directory_listing', 'contact_disclosure') then
    update public.talent_public set is_paused = true where user_id = v_uid;
  end if;
end $$;

-- 5.2 Onboarding
create function public.create_talent_profile(
  p_role public.role_type, p_full_name text, p_city text, p_state text,
  p_latitude numeric, p_longitude numeric, p_native_language text,
  p_secondary_languages text[], p_skills text[], p_hourly_rate_paise bigint,
  p_phone_e164 text, p_whatsapp_number text, p_email text,
  p_portfolio_links jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid; v_gh_id text; v_gh_user text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.talent_public where user_id = v_uid) then raise exception 'profile_exists'; end if;
  if btrim(coalesce(p_full_name, '')) = '' then raise exception 'full_name_required'; end if;
  if not private.has_consents(v_uid, array['dpdp_directory_listing', 'contact_disclosure', 'phone_processing']) then
    raise exception 'consent_required';
  end if;

  if p_role = 'developer' then
    select i.identity_data ->> 'sub',
           coalesce(i.identity_data ->> 'user_name', i.identity_data ->> 'preferred_username')
      into v_gh_id, v_gh_user
      from auth.identities i where i.user_id = v_uid and i.provider = 'github';
    if v_gh_id is null then raise exception 'github_login_required'; end if;
  end if;

  if exists (select 1 from public.blocklist b
              where (b.kind = 'phone'  and b.value_hash = private.hash_value(private.digits(p_phone_e164)))
                 or (b.kind = 'github' and v_gh_user is not null and b.value_hash = private.hash_value(v_gh_user))) then
    raise exception 'account_blocked';
  end if;

  insert into public.talent_public (user_id, role, masked_name, city, state, latitude, longitude,
                                    native_language, secondary_languages, skills, hourly_rate_paise)
  values (v_uid, p_role, private.mask_name(p_full_name), btrim(p_city), btrim(p_state), p_latitude, p_longitude,
          btrim(p_native_language), coalesce(p_secondary_languages, '{}'), coalesce(p_skills, '{}'), p_hourly_rate_paise)
  returning id into v_id;

  insert into public.talent_private (talent_id, full_name, phone_e164, whatsapp_number, email,
                                     github_user_id, github_username, portfolio_links, daily_unlock_cap)
  values (v_id, btrim(p_full_name), p_phone_e164, p_whatsapp_number, lower(btrim(p_email)),
          v_gh_id, v_gh_user, coalesce(p_portfolio_links, '[]'::jsonb), private.cfg('default_daily_unlock_cap'));

  perform private.sync_phone_verification(v_uid);
  return v_id;
end $$;

create function public.create_recruiter_profile(p_phone_e164 text, p_company_name text default null, p_gstin text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.recruiters where user_id = v_uid) then raise exception 'profile_exists'; end if;
  if not private.has_consents(v_uid, array['recruiter_terms']) then raise exception 'consent_required'; end if;
  insert into public.recruiters (user_id, phone_e164, company_name, gstin)
  values (v_uid, p_phone_e164, nullif(btrim(p_company_name), ''), nullif(upper(btrim(p_gstin)), ''))
  returning id into v_id;
  perform private.sync_phone_verification(v_uid);
  return v_id;
end $$;

-- Call after the phone-OTP step succeeds (Supabase Auth confirms the number)
create function public.sync_phone_verification() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return private.sync_phone_verification(auth.uid());
end $$;

-- Location changes are limited (stops people hopping to a thinner state leaderboard)
create function public.change_location(p_city text, p_state text, p_latitude numeric, p_longitude numeric)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.talent_public%rowtype;
begin
  select * into v from public.talent_public where user_id = auth.uid() and deleted_at is null for update;
  if not found then raise exception 'profile_required'; end if;
  if v.location_changed_at is not null
     and v.location_changed_at > now() - make_interval(days => private.cfg('location_change_cooldown_days')) then
    raise exception 'location_change_cooldown';
  end if;
  update public.talent_public
     set city = btrim(p_city), state = btrim(p_state), latitude = p_latitude, longitude = p_longitude,
         location_changed_at = now()
   where id = v.id;
end $$;

-- 5.3 Telegram linking (token goes into t.me/DevMapBot?start=<token>)
create function public.create_telegram_link_token() returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_token text;
begin
  select id into v_id from public.talent_public where user_id = auth.uid() and deleted_at is null;
  if v_id is null then raise exception 'profile_required'; end if;
  v_token := encode(extensions.gen_random_bytes(12), 'hex');
  delete from public.telegram_link_tokens where talent_id = v_id;
  insert into public.telegram_link_tokens (token_hash, talent_id, expires_at)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_id, now() + interval '15 minutes');
  return v_token;
end $$;

-- 5.4 Projects
create function public.add_project(p_title text, p_live_url text, p_repo_url text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tid uuid; v_pid uuid; v_token text;
begin
  select id into v_tid from public.talent_public where user_id = auth.uid() and deleted_at is null;
  if v_tid is null then raise exception 'profile_required'; end if;
  if (select count(*) from public.projects where talent_id = v_tid) >= 5 then raise exception 'project_limit_reached'; end if;
  insert into public.projects (talent_id, generic_title, live_url, repo_url)
  values (v_tid, btrim(p_title), btrim(p_live_url), nullif(btrim(p_repo_url), ''))
  returning id, verification_token into v_pid, v_token;
  return jsonb_build_object('project_id', v_pid, 'verification_token', v_token,
                            'verify_file_path', '/devmap-verify.txt',
                            'verify_file_content', 'devmap-verify=' || v_token);
end $$;

-- 5.5 Quote (tier + credits) for a visible profile; safe for anon/authenticated
create function public.unlock_quote(p_talent_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.talent_public%rowtype; t public.unlock_tier;
begin
  select * into v from public.talent_public
   where id = p_talent_id and is_listed and not is_paused and not is_banned and deleted_at is null
     and (suspended_until is null or suspended_until <= now());
  if not found then return null; end if;
  t := private.tier_for(v.composite_rank_score, v.last_active_at);
  return jsonb_build_object('tier', t,
           'credits', case t when 'top_tier' then private.cfg('tier1_unlock_credits')
                             else private.cfg('standard_unlock_credits') end);
end $$;

-- 5.6 THE UNLOCK: atomic, idempotent, returns only 4 fields
create function public.unlock_talent_contact(p_talent_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid       uuid := auth.uid();
  v_today     date := (now() at time zone 'Asia/Kolkata')::date;
  v_rec       public.recruiters%rowtype;
  v_tp        public.talent_public%rowtype;
  v_priv      public.talent_private%rowtype;
  v_unlock    public.lead_unlocks%rowtype;
  v_tier      public.unlock_tier;
  v_cost      int;
  v_use_trial boolean := false;
  v_unlock_id uuid;
  v_count     int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  -- Lock the recruiter row first: serialises this recruiter's concurrent unlocks
  select * into v_rec from public.recruiters where user_id = v_uid and deleted_at is null for update;
  if not found then raise exception 'recruiter_profile_required'; end if;
  if not v_rec.is_phone_verified then raise exception 'phone_verification_required'; end if;

  -- Already unlocked? Re-viewing is free; a refunded (ghosted) unlock stays closed.
  select * into v_unlock from public.lead_unlocks where recruiter_id = v_rec.id and talent_id = p_talent_id;
  if found then
    if v_unlock.refunded_at is not null then raise exception 'unlock_refunded'; end if;
    return private.contact_payload(p_talent_id);
  end if;

  -- Lock the talent's contact row (guards the daily-cap counter)
  select * into v_priv from public.talent_private where talent_id = p_talent_id for update;
  if not found then raise exception 'talent_unavailable'; end if;
  select * into v_tp from public.talent_public where id = p_talent_id;

  if v_tp.user_id is not null and v_tp.user_id = v_uid then raise exception 'cannot_unlock_self'; end if;
  if not v_tp.is_listed or v_tp.is_paused or v_tp.is_banned or v_tp.deleted_at is not null
     or (v_tp.suspended_until is not null and v_tp.suspended_until > now()) then
    raise exception 'talent_unavailable';
  end if;

  if v_priv.cap_date <> v_today then v_priv.unlocks_today := 0; end if;
  if v_priv.unlocks_today >= v_priv.daily_unlock_cap then raise exception 'talent_daily_limit_reached'; end if;

  -- Price: tier 1 (score >= 75 and active in last 7 days) = 2 credits, otherwise 1
  v_tier := private.tier_for(v_tp.composite_rank_score, v_tp.last_active_at);
  v_cost := case v_tier when 'top_tier' then private.cfg('tier1_unlock_credits')
                        else private.cfg('standard_unlock_credits') end;

  -- Free preview covers STANDARD-tier profiles only
  if v_tier = 'standard' and v_rec.trial_unlocks_remaining > 0 then v_use_trial := true; end if;
  if not v_use_trial and v_rec.credits_balance < v_cost then raise exception 'insufficient_credits'; end if;

  insert into public.lead_unlocks (recruiter_id, talent_id, tier_at_unlock, credits_deducted, is_trial, talent_online_at_unlock)
  values (v_rec.id, p_talent_id, v_tier, case when v_use_trial then 0 else v_cost end, v_use_trial, v_tp.is_online)
  returning id into v_unlock_id;

  if v_use_trial then
    update public.recruiters set trial_unlocks_remaining = trial_unlocks_remaining - 1 where id = v_rec.id;
    perform private.apply_credit_delta(v_rec.id, 0, 'unlock_trial', v_unlock_id);
  else
    perform private.apply_credit_delta(v_rec.id, -v_cost,
              case v_tier when 'top_tier' then 'unlock_top' else 'unlock_standard' end, v_unlock_id);
  end if;

  v_count := v_priv.unlocks_today + 1;
  update public.talent_private set unlocks_today = v_count, cap_date = v_today where talent_id = p_talent_id;
  if v_count >= v_priv.daily_unlock_cap then
    update public.talent_public set is_at_daily_cap = true where id = p_talent_id;
  end if;

  return private.contact_payload(p_talent_id);
end $$;

-- 5.7 "Open WhatsApp": records the click (needed for ghost reports), returns the wa.me base URL
create function public.open_whatsapp(p_talent_id uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u public.lead_unlocks%rowtype; v_wa text;
begin
  select u.* into v_u
    from public.lead_unlocks u join public.recruiters r on r.id = u.recruiter_id
   where r.user_id = auth.uid() and u.talent_id = p_talent_id and u.refunded_at is null
   for update of u;
  if not found then raise exception 'unlock_not_found'; end if;
  select whatsapp_number into v_wa from public.talent_private where talent_id = p_talent_id;
  if v_wa is null then raise exception 'talent_unavailable'; end if;
  update public.lead_unlocks
     set has_clicked_whatsapp = true, whatsapp_clicked_at = coalesce(whatsapp_clicked_at, now())
   where id = v_u.id;
  return 'https://wa.me/' || private.digits(v_wa);
end $$;

-- 5.8 Thumbs-up / not-a-fit (neutral). Needs a prior "Open WhatsApp" click.
create function public.submit_lead_feedback(p_talent_id uuid, p_rating text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u public.lead_unlocks%rowtype;
begin
  if p_rating not in ('responsive', 'not_fit') then raise exception 'invalid_rating'; end if;
  select u.* into v_u
    from public.lead_unlocks u join public.recruiters r on r.id = u.recruiter_id
   where r.user_id = auth.uid() and u.talent_id = p_talent_id;
  if not found then raise exception 'unlock_not_found'; end if;
  if not v_u.has_clicked_whatsapp then raise exception 'whatsapp_not_opened'; end if;
  insert into public.lead_feedback (unlock_id, recruiter_id, talent_id, rating)
  values (v_u.id, v_u.recruiter_id, v_u.talent_id, p_rating);
  perform private.recompute_response_velocity(p_talent_id);
end $$;

-- 5.9 Report ghosting. Rules: paid unlock only, WhatsApp opened, 24h wait, 7-day window, 2 reports / month.
create function public.report_ghosting(p_talent_id uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_u   public.lead_unlocks%rowtype;
  v_id  uuid;
  v_month_start timestamptz := (date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
begin
  select u.* into v_u
    from public.lead_unlocks u join public.recruiters r on r.id = u.recruiter_id
   where r.user_id = auth.uid() and u.talent_id = p_talent_id
   for update of u;
  if not found then raise exception 'unlock_not_found'; end if;
  if v_u.is_trial then raise exception 'trial_unlocks_not_reportable'; end if;
  if not v_u.has_clicked_whatsapp then raise exception 'whatsapp_not_opened'; end if;
  if v_u.refunded_at is not null then raise exception 'already_refunded'; end if;
  if now() < v_u.whatsapp_clicked_at + make_interval(hours => private.cfg('ghost_report_min_wait_hours')) then
    raise exception 'delivery_window_open';
  end if;
  if now() > v_u.created_at + make_interval(days => private.cfg('ghost_report_max_age_days')) then
    raise exception 'report_window_closed';
  end if;
  if exists (select 1 from public.ghost_reports where unlock_id = v_u.id) then raise exception 'already_reported'; end if;
  if (select count(*) from public.ghost_reports
       where recruiter_id = v_u.recruiter_id and created_at >= v_month_start) >= private.cfg('ghost_report_monthly_cap') then
    raise exception 'monthly_report_cap_reached';
  end if;

  insert into public.ghost_reports (unlock_id, recruiter_id, talent_id, recruiter_note, talent_deadline)
  values (v_u.id, v_u.recruiter_id, v_u.talent_id, left(p_note, 500),
          now() + make_interval(hours => private.cfg('talent_dispute_hours')))
  returning id into v_id;
  return v_id;
end $$;

-- 5.10 Anonymise (never hard-delete) everything personal; keep financial + consent audit rows.
--      After this returns, the Edge Function deletes the auth user (FKs are SET NULL).
create function public.erase_my_account(p_forfeit_credits boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_tid uuid; v_rid uuid; v_balance int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select id into v_tid from public.talent_public where user_id = v_uid and deleted_at is null;
  if v_tid is not null then
    delete from public.talent_private where talent_id = v_tid;
    delete from public.projects        where talent_id = v_tid;         -- cascades pings + attestations
    delete from public.rank_snapshots  where talent_id = v_tid;
    delete from public.telegram_link_tokens where talent_id = v_tid;
    update public.ghost_reports set talent_dispute_note = null, evidence_urls = '{}' where talent_id = v_tid;
    update public.review_queue  set evidence_urls = '{}', reviewer_notes = null where talent_id = v_tid;
    update public.consents set subject_ref = v_tid
     where user_id = v_uid
       and consent_type in ('dpdp_directory_listing','contact_disclosure','telegram_notifications','phone_processing');
    update public.talent_public set
      user_id = null, masked_name = 'Deleted talent', city = '-', state = '-', latitude = null, longitude = null,
      native_language = '-', secondary_languages = '{}', skills = '{}', score_breakdown = '{}'::jsonb,
      is_online = false, is_paused = true, deleted_at = now()
     where id = v_tid;
  end if;

  select id, credits_balance into v_rid, v_balance from public.recruiters where user_id = v_uid and deleted_at is null for update;
  if v_rid is not null then
    if v_balance > 0 and not p_forfeit_credits then raise exception 'credits_remaining'; end if;
    if v_balance > 0 then perform private.apply_credit_delta(v_rid, -v_balance, 'admin_adjustment', v_rid); end if;
    update public.consents set subject_ref = v_rid where user_id = v_uid and consent_type = 'recruiter_terms';
    update public.recruiters set
      user_id = null, phone_e164 = 'erased:' || id::text, is_phone_verified = false,
      company_name = null,                     -- gstin kept: tax identifier on invoices (7-year retention)
      deleted_at = now()
     where id = v_rid;
  end if;

  -- consent evidence is retained but de-identified
  update public.consents set user_id = null, ip_address = null, user_agent = null, erased_at = now()
   where user_id = v_uid;
end $$;


-- ---------------------------------------------------------------------
-- 6. SERVICE-ROLE / ADMIN FUNCTIONS (Edge Functions, bot, workers)
-- ---------------------------------------------------------------------

-- 6.1 Razorpay
create function public.create_payment_order(p_recruiter uuid, p_bundle text, p_idempotency_key text, p_razorpay_order_id text)
returns public.payments
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.payments%rowtype;
  v_registered boolean := coalesce(private.cfg('gst_registered'), 0) = 1;
  v_rate int := coalesce(private.cfg('gst_rate_percent'), 18);
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  insert into public.payments (recruiter_id, bundle_id, credits_granted, amount_paise, gst_included_paise,
                               idempotency_key, razorpay_order_id)
  select p_recruiter, b.id, b.credits, b.price_paise,
         case when v_registered then round(b.price_paise * v_rate / (100.0 + v_rate)) else 0 end,   -- price is inclusive
         p_idempotency_key, p_razorpay_order_id
    from public.credit_bundles b where b.id = p_bundle and b.is_active
  on conflict (idempotency_key) do nothing;
  select * into v from public.payments where idempotency_key = p_idempotency_key and recruiter_id = p_recruiter;
  if not found then raise exception 'bundle_unavailable'; end if;
  return v;
end $$;

-- Call ONLY after verifying x-razorpay-signature. Safe to call repeatedly (webhooks retry).
create function public.fulfill_payment(p_order_id text, p_payment_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.payments%rowtype;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  select * into v from public.payments where razorpay_order_id = p_order_id for update;
  if not found then raise exception 'unknown_order'; end if;
  if v.status = 'captured' then return jsonb_build_object('status', 'already_captured'); end if;
  if v.status = 'refunded' then raise exception 'payment_refunded'; end if;
  update public.payments set status = 'captured', razorpay_payment_id = p_payment_id, captured_at = now() where id = v.id;
  perform private.apply_credit_delta(v.recruiter_id, v.credits_granted, 'purchase', v.id);
  return jsonb_build_object('status', 'captured', 'credits', v.credits_granted);
end $$;

-- 6.2 Telegram bot
create function public.link_telegram(p_token text, p_chat_id bigint, p_username text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t public.telegram_link_tokens%rowtype;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  select * into v_t from public.telegram_link_tokens
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and used_at is null and expires_at > now() for update;
  if not found then raise exception 'invalid_or_expired_token'; end if;
  begin
    update public.talent_private
       set telegram_chat_id = p_chat_id,
           telegram_handle  = case when nullif(btrim(p_username), '') is null then null else '@' || btrim(p_username) end
     where talent_id = v_t.talent_id;
  exception when unique_violation then
    raise exception 'telegram_already_linked';
  end;
  update public.telegram_link_tokens set used_at = now() where token_hash = v_t.token_hash;
  return v_t.talent_id;
end $$;

create function public.mark_lead_notified(p_unlock_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  update public.lead_unlocks set talent_notified_at = coalesce(talent_notified_at, now()) where id = p_unlock_id;
end $$;

-- Talent taps "Got it" on the Telegram lead alert
create function public.acknowledge_lead(p_unlock_id uuid, p_chat_id bigint) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t uuid;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  update public.lead_unlocks u set talent_acknowledged_at = now()
    from public.talent_private tp
   where u.id = p_unlock_id and tp.talent_id = u.talent_id and tp.telegram_chat_id = p_chat_id
     and u.talent_acknowledged_at is null
  returning u.talent_id into v_t;
  if v_t is null then return false; end if;
  perform private.recompute_response_velocity(v_t);
  return true;
end $$;

-- Weekly "still available?" tap
create function public.confirm_availability(p_chat_id bigint) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  update public.talent_public t set last_active_at = now()
    from public.talent_private p where p.talent_id = t.id and p.telegram_chat_id = p_chat_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- Talent's reply to a ghost report (screenshot URL) -> manual review, no penalty meanwhile
create function public.submit_ghost_dispute(p_report_id uuid, p_chat_id bigint, p_note text, p_evidence_urls text[])
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r public.ghost_reports%rowtype;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  select r.* into v_r
    from public.ghost_reports r join public.talent_private tp on tp.talent_id = r.talent_id
   where r.id = p_report_id and tp.telegram_chat_id = p_chat_id for update of r;
  if not found then return false; end if;
  if v_r.status <> 'awaiting_talent' or now() > v_r.talent_deadline then return false; end if;
  update public.ghost_reports
     set status = 'under_review', talent_dispute_note = left(p_note, 500), evidence_urls = coalesce(p_evidence_urls, '{}')
   where id = p_report_id;
  insert into public.review_queue (talent_id, type, related_id, evidence_urls)
  values (v_r.talent_id, 'ghost_dispute', p_report_id, coalesce(p_evidence_urls, '{}'));
  return true;
end $$;

-- 6.3 Scoring workers
-- GitHub worker: commits = authored, original (non-fork), default-branch commits in the last 90 days
create function public.set_work_depth_from_commits(p_talent uuid, p_commits_90d int, p_last_commit_at timestamptz,
                                                   p_meta jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.talent_public where id = p_talent and role = 'developer' and deleted_at is null) then
    raise exception 'developer_profile_required';
  end if;
  update public.talent_public set
    score_breakdown = score_breakdown || coalesce(p_meta, '{}'::jsonb) ||
                      jsonb_build_object('work_depth', private.commit_points(p_commits_90d),
                                         'commits_90d', p_commits_90d, 'last_commit_at', p_last_commit_at),
    last_proof_activity_at = coalesce(p_last_commit_at, last_proof_activity_at)
  where id = p_talent;
  perform private.recompute_proof(p_talent);
end $$;

-- Verification worker: client attestation request (raw contact never stored)
create function public.create_client_attestation(p_project uuid, p_channel text, p_contact_masked text,
                                                 p_contact_hmac text, p_token_hash text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  -- one client contact may attest at most 2 projects per 30 days (anti-collusion)
  if (select count(*) from public.client_attestations
       where contact_hmac = p_contact_hmac and status = 'confirmed' and created_at > now() - interval '30 days') >= 2 then
    raise exception 'attestor_limit_reached';
  end if;
  if (select count(*) from public.client_attestations where project_id = p_project and status = 'pending') >= 3 then
    raise exception 'too_many_pending';
  end if;
  insert into public.client_attestations (project_id, channel, contact_masked, contact_hmac, token_hash)
  values (p_project, p_channel, p_contact_masked, p_contact_hmac, p_token_hash)
  returning id into v_id;
  return v_id;
end $$;

-- The client clicks the link (no account) -> anon-callable, token-gated
create function public.respond_client_attestation(p_token text, p_confirm boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a public.client_attestations%rowtype; v_talent uuid;
begin
  select * into v_a from public.client_attestations
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and status = 'pending' and expires_at > now() for update;
  if not found then return 'invalid'; end if;

  update public.client_attestations
     set status = case when p_confirm then 'confirmed' else 'declined' end, responded_at = now()
   where id = v_a.id;

  if p_confirm then
    update public.projects
       set is_ownership_verified = true,
           verification_method = case when verification_method = 'none' then 'client_attestation' else verification_method end,
           verified_at = coalesce(verified_at, now())
     where id = v_a.project_id
    returning talent_id into v_talent;
    if random() < 0.10 then   -- 10% random manual spot-check
      insert into public.review_queue (talent_id, type, related_id) values (v_talent, 'attestation_spotcheck', v_a.id);
    end if;
    return 'confirmed';
  end if;
  return 'declined';
end $$;

-- 6.4 Admin actions (service_role key or JWT app_metadata.role = 'admin')
create function public.admin_set_talent_review(p_talent uuid, p_status public.review_tier, p_work_depth int,
                                               p_notes text default null, p_queue_id uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if p_work_depth not between 0 and 40 then raise exception 'work_depth_out_of_range'; end if;
  update public.talent_public set
    review_status = p_status,
    last_proof_activity_at = now(),
    score_breakdown = score_breakdown || jsonb_build_object('work_depth', p_work_depth, 'reviewed_at', now())
  where id = p_talent and deleted_at is null;
  perform private.recompute_proof(p_talent);
  if p_queue_id is not null then
    update public.review_queue
       set status = case when p_status = 'unverified' then 'rejected' else 'approved' end,
           reviewer_notes = p_notes, reviewer_id = auth.uid(), resolved_at = now()
     where id = p_queue_id;
  end if;
end $$;

create function public.admin_resolve_ghost_report(p_report uuid, p_uphold boolean, p_notes text default null,
                                                  p_queue_id uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if p_uphold then
    perform private.uphold_ghost_report(p_report, p_notes);
  else
    update public.ghost_reports set status = 'rejected', resolved_at = now(), resolution_notes = p_notes
     where id = p_report and status in ('awaiting_talent', 'under_review');
  end if;
  if p_queue_id is not null then
    update public.review_queue set status = case when p_uphold then 'approved' else 'rejected' end,
           reviewer_notes = p_notes, reviewer_id = auth.uid(), resolved_at = now()
     where id = p_queue_id;
  end if;
end $$;

-- Permanent ban (Strike 3 only after a human has looked at it). Blocklists phone + GitHub as hashes.
create function public.admin_ban_talent(p_talent uuid, p_notes text default null, p_queue_id uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_phone text; v_gh text;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  select phone_e164, github_username into v_phone, v_gh from public.talent_private where talent_id = p_talent;
  update public.talent_public set is_banned = true, is_online = false where id = p_talent;
  if v_phone is not null then
    insert into public.blocklist (kind, value_hash, reason)
    values ('phone', private.hash_value(private.digits(v_phone)), left(p_notes, 200)) on conflict do nothing;
  end if;
  if v_gh is not null then
    insert into public.blocklist (kind, value_hash, reason)
    values ('github', private.hash_value(v_gh), left(p_notes, 200)) on conflict do nothing;
  end if;
  if p_queue_id is not null then
    update public.review_queue set status = 'approved', reviewer_notes = p_notes, reviewer_id = auth.uid(), resolved_at = now()
     where id = p_queue_id;
  end if;
end $$;

-- Lift a suspension / reverse a ban after review or appeal
create function public.admin_restore_talent(p_talent uuid, p_notes text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  update public.talent_public set is_banned = false, suspended_until = null where id = p_talent;
  update public.strikes set status = 'overturned' where talent_id = p_talent and status = 'active';
  perform private.recompute_response_velocity(p_talent);
end $$;


-- ---------------------------------------------------------------------
-- 7. SCHEDULED JOBS (functions; scheduled in section 11)
-- ---------------------------------------------------------------------
create function private.expire_online_status() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  update public.talent_public set is_online = false
   where is_online and online_since < now() - make_interval(hours => private.cfg('online_expiry_hours'));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function private.reset_daily_caps() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.talent_private set unlocks_today = 0, cap_date = (now() at time zone 'Asia/Kolkata')::date
   where cap_date <> (now() at time zone 'Asia/Kolkata')::date;
  update public.talent_public set is_at_daily_cap = false where is_at_daily_cap;
end $$;

-- Talent stayed silent past the 12h window -> upheld automatically (strike + refund)
create function private.resolve_expired_ghost_reports() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_n int := 0;
begin
  for r in select id from public.ghost_reports
            where status = 'awaiting_talent' and talent_deadline < now()
            for update skip locked
  loop
    perform private.uphold_ghost_report(r.id, 'auto: talent did not respond within the dispute window');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create function private.recompute_all_velocities() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select id from public.talent_public where deleted_at is null loop
    perform private.recompute_response_velocity(r.id);
  end loop;
end $$;

-- Daily leaderboard: ties broken by 1) verified live apps 2) 30d uptime 3) recency
create function private.take_rank_snapshot() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  with ranked as (
    select t.id, t.role, t.state, t.composite_rank_score,
           rank() over (partition by t.role, t.state
                        order by t.composite_rank_score desc, t.verified_live_apps desc,
                                 t.uptime_30d_avg desc, t.last_proof_activity_at desc nulls last) as rnk,
           count(*) over (partition by t.role, t.state) as cohort
    from public.talent_public t
    where t.is_listed and not t.is_paused and not t.is_banned and t.deleted_at is null
      and (t.suspended_until is null or t.suspended_until <= now())
  ), snap as (
    insert into public.rank_snapshots (talent_id, role, state, rank, cohort_size, score)
    select id, role, state, rnk, cohort, composite_rank_score from ranked
    on conflict (talent_id, recorded_on) do update
      set rank = excluded.rank, cohort_size = excluded.cohort_size, score = excluded.score,
          role = excluded.role, state = excluded.state
    returning 1
  )
  update public.talent_public t set state_rank = r.rnk, state_cohort_size = r.cohort
    from ranked r where t.id = r.id;

  update public.talent_public set state_rank = null, state_cohort_size = null
   where (not is_listed or is_paused or is_banned or deleted_at is not null
          or (suspended_until is not null and suspended_until > now()))
     and (state_rank is not null or state_cohort_size is not null);
end $$;

create function private.purge_old_operational_data() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.ping_results where checked_at < now() - interval '60 days';
  delete from public.telegram_link_tokens where expires_at < now() - interval '1 day';
  update public.client_attestations set status = 'expired' where status = 'pending' and expires_at < now();
  -- NOTE: payments, credits_ledger, lead_unlocks, consents are retained 7 years (see PRD §12).
end $$;


-- ---------------------------------------------------------------------
-- 8. VIEW for the Telegram worker: day-over-day rank movement (service_role only)
-- ---------------------------------------------------------------------
create view public.rank_moves as
select cur.talent_id, cur.role, cur.state,
       prev.rank as prev_rank, cur.rank as new_rank, (cur.rank - prev.rank) as delta, cur.recorded_on
from public.rank_snapshots cur
join public.rank_snapshots prev
  on prev.talent_id = cur.talent_id and prev.recorded_on = cur.recorded_on - 1
where cur.recorded_on = (select max(recorded_on) from public.rank_snapshots);


-- ---------------------------------------------------------------------
-- 9. ROW LEVEL SECURITY + GRANTS
--    Everything is denied by default; each grant below is deliberate.
-- ---------------------------------------------------------------------
alter table public.app_config           enable row level security;
alter table public.skills               enable row level security;
alter table public.talent_public        enable row level security;
alter table public.talent_private       enable row level security;
alter table public.projects             enable row level security;
alter table public.ping_results         enable row level security;
alter table public.client_attestations  enable row level security;
alter table public.recruiters           enable row level security;
alter table public.credits_ledger       enable row level security;
alter table public.credit_bundles       enable row level security;
alter table public.payments             enable row level security;
alter table public.lead_unlocks         enable row level security;
alter table public.lead_feedback        enable row level security;
alter table public.ghost_reports        enable row level security;
alter table public.strikes              enable row level security;
alter table public.rank_snapshots       enable row level security;
alter table public.review_queue         enable row level security;
alter table public.consents             enable row level security;
alter table public.blocklist            enable row level security;
alter table public.telegram_link_tokens enable row level security;

-- start from zero
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- 9.1 skills: public read-only
grant select on public.skills to anon, authenticated;
create policy skills_read on public.skills for select to anon, authenticated using (true);

-- 9.2 talent_public: anon reads LISTED rows only; owners read/edit their own
grant select on public.talent_public to anon, authenticated;
create policy talent_public_read_listed on public.talent_public for select to anon, authenticated
  using (is_listed and not is_paused and not is_banned and deleted_at is null
         and (suspended_until is null or suspended_until <= now()));
create policy talent_public_read_own on public.talent_public for select to authenticated
  using (user_id = (select auth.uid()));
-- owners may change ONLY these columns; scores, tier, listing flags, location are server-controlled
grant update (native_language, secondary_languages, skills, hourly_rate_paise, is_online, is_paused)
  on public.talent_public to authenticated;
create policy talent_public_update_own on public.talent_public for update to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null)
  with check (user_id = (select auth.uid()));

-- 9.3 talent_private: owner only. Recruiters get data ONLY via unlock_talent_contact().
grant select on public.talent_private to authenticated;
create policy talent_private_owner_read on public.talent_private for select to authenticated
  using (exists (select 1 from public.talent_public t
                  where t.id = talent_private.talent_id and t.user_id = (select auth.uid())));
grant update (portfolio_links, daily_unlock_cap) on public.talent_private to authenticated;
create policy talent_private_owner_update on public.talent_private for update to authenticated
  using (exists (select 1 from public.talent_public t
                  where t.id = talent_private.talent_id and t.user_id = (select auth.uid())))
  with check (exists (select 1 from public.talent_public t
                       where t.id = talent_private.talent_id and t.user_id = (select auth.uid())));

-- 9.4 projects / pings / attestations: owner can read; add via add_project(); delete own
grant select, delete on public.projects to authenticated;
grant update (generic_title) on public.projects to authenticated;
create policy projects_owner_read on public.projects for select to authenticated
  using (exists (select 1 from public.talent_public t where t.id = projects.talent_id and t.user_id = (select auth.uid())));
create policy projects_owner_update on public.projects for update to authenticated
  using (exists (select 1 from public.talent_public t where t.id = projects.talent_id and t.user_id = (select auth.uid())))
  with check (exists (select 1 from public.talent_public t where t.id = projects.talent_id and t.user_id = (select auth.uid())));
create policy projects_owner_delete on public.projects for delete to authenticated
  using (exists (select 1 from public.talent_public t where t.id = projects.talent_id and t.user_id = (select auth.uid())));

grant select on public.ping_results to authenticated;
create policy ping_results_owner_read on public.ping_results for select to authenticated
  using (exists (select 1 from public.projects p join public.talent_public t on t.id = p.talent_id
                  where p.id = ping_results.project_id and t.user_id = (select auth.uid())));

grant select (id, project_id, channel, contact_masked, status, expires_at, responded_at, created_at)
  on public.client_attestations to authenticated;
create policy client_attestations_owner_read on public.client_attestations for select to authenticated
  using (exists (select 1 from public.projects p join public.talent_public t on t.id = p.talent_id
                  where p.id = client_attestations.project_id and t.user_id = (select auth.uid())));

-- 9.5 recruiter money + history: owner read-only (all writes go through functions)
grant select on public.recruiters to authenticated;
grant update (company_name, gstin) on public.recruiters to authenticated;
create policy recruiters_owner_read on public.recruiters for select to authenticated
  using (user_id = (select auth.uid()));
create policy recruiters_owner_update on public.recruiters for update to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null) with check (user_id = (select auth.uid()));

grant select on public.credits_ledger to authenticated;
create policy credits_ledger_owner_read on public.credits_ledger for select to authenticated
  using (recruiter_id in (select id from public.recruiters where user_id = (select auth.uid())));

grant select on public.credit_bundles to authenticated;
create policy credit_bundles_read on public.credit_bundles for select to authenticated using (is_active);

grant select on public.payments to authenticated;
create policy payments_owner_read on public.payments for select to authenticated
  using (recruiter_id in (select id from public.recruiters where user_id = (select auth.uid())));

grant select on public.lead_unlocks to authenticated;
create policy lead_unlocks_owner_read on public.lead_unlocks for select to authenticated
  using (recruiter_id in (select id from public.recruiters where user_id = (select auth.uid())));

grant select on public.lead_feedback to authenticated;
create policy lead_feedback_owner_read on public.lead_feedback for select to authenticated
  using (recruiter_id in (select id from public.recruiters where user_id = (select auth.uid())));

-- recruiter sees status of their report; NOT the talent's evidence
grant select (id, unlock_id, talent_id, status, talent_deadline, recruiter_note, created_at, resolved_at)
  on public.ghost_reports to authenticated;
create policy ghost_reports_owner_read on public.ghost_reports for select to authenticated
  using (recruiter_id in (select id from public.recruiters where user_id = (select auth.uid())));

-- 9.6 talent-side reads of their own moderation / rank data
grant select on public.strikes to authenticated;
create policy strikes_talent_read on public.strikes for select to authenticated
  using (exists (select 1 from public.talent_public t where t.id = strikes.talent_id and t.user_id = (select auth.uid())));

grant select on public.rank_snapshots to authenticated;
create policy rank_snapshots_owner_read on public.rank_snapshots for select to authenticated
  using (exists (select 1 from public.talent_public t where t.id = rank_snapshots.talent_id and t.user_id = (select auth.uid())));

grant select (id, type, status, reviewer_notes, created_at, resolved_at) on public.review_queue to authenticated;
create policy review_queue_owner_read on public.review_queue for select to authenticated
  using (exists (select 1 from public.talent_public t where t.id = review_queue.talent_id and t.user_id = (select auth.uid())));

grant select (id, consent_type, policy_version, consented_at, withdrawn_at) on public.consents to authenticated;
create policy consents_owner_read on public.consents for select to authenticated
  using (user_id = (select auth.uid()));

-- 9.7 app_config, blocklist, telegram_link_tokens, rank_moves: NO client access (service_role only)
revoke all on public.rank_moves from anon, authenticated;
grant select on public.rank_moves to service_role;

-- 9.8 Function execute permissions
grant execute on function
  public.record_consent(text, text),
  public.withdraw_consent(text),
  public.create_talent_profile(public.role_type, text, text, text, numeric, numeric, text, text[], text[], bigint, text, text, text, jsonb),
  public.create_recruiter_profile(text, text, text),
  public.sync_phone_verification(),
  public.change_location(text, text, numeric, numeric),
  public.create_telegram_link_token(),
  public.add_project(text, text, text),
  public.unlock_quote(uuid),
  public.unlock_talent_contact(uuid),
  public.open_whatsapp(uuid),
  public.submit_lead_feedback(uuid, text),
  public.report_ghosting(uuid, text),
  public.erase_my_account(boolean)
  to authenticated;

grant execute on function public.unlock_quote(uuid) to anon;
grant execute on function public.respond_client_attestation(text, boolean) to anon, authenticated;

grant execute on function
  public.create_payment_order(uuid, text, text, text),
  public.fulfill_payment(text, text),
  public.link_telegram(text, bigint, text),
  public.mark_lead_notified(uuid),
  public.acknowledge_lead(uuid, bigint),
  public.confirm_availability(bigint),
  public.submit_ghost_dispute(uuid, bigint, text, text[]),
  public.set_work_depth_from_commits(uuid, int, timestamptz, jsonb),
  public.create_client_attestation(uuid, text, text, text, text),
  public.admin_set_talent_review(uuid, public.review_tier, int, text, uuid),
  public.admin_resolve_ghost_report(uuid, boolean, text, uuid),
  public.admin_ban_talent(uuid, text, uuid),
  public.admin_restore_talent(uuid, text)
  to service_role;


-- ---------------------------------------------------------------------
-- 10. SEEDS
-- ---------------------------------------------------------------------
insert into public.app_config (key, value_int, note) values
  ('standard_unlock_credits',       1,  'credits for a standard-tier unlock'),
  ('tier1_unlock_credits',          2,  'credits for a Tier 1 (score >= 75) unlock'),
  ('tier1_min_score',               75, 'composite score needed for Tier 1'),
  ('tier1_active_days',             7,  'Tier 1 also requires activity within N days'),
  ('online_expiry_hours',           8,  'auto-flip Online -> Offline'),
  ('talent_dispute_hours',          12, 'talent window to answer a ghost report'),
  ('ghost_report_min_wait_hours',   24, 'wait after opening WhatsApp before reporting'),
  ('ghost_report_max_age_days',     7,  'reports must be filed within N days of unlock'),
  ('ghost_report_monthly_cap',      2,  'ghost reports a recruiter may file per calendar month (IST)'),
  ('strike_expiry_days',            90, 'strikes expire after N days'),
  ('strike2_suspension_days',       14, 'suspension length at 2 active strikes'),
  ('default_daily_unlock_cap',      5,  'default unlocks per talent per day'),
  ('location_change_cooldown_days', 30, 'min days between city/state changes'),
  ('gst_registered',                0,  '1 once GST-registered; controls gst_included_paise on payments'),
  ('gst_rate_percent',              18, 'GST rate for inclusive-price split');

insert into public.credit_bundles (id, label, credits, price_paise, sort_order) values
  ('credits_1',  '1 Credit',   1,  9900, 1),
  ('credits_3',  '3 Credits',  3,  24900, 2),
  ('credits_10', '10 Credits', 10, 79900, 3);

insert into public.skills (slug, label, role, category, sort_order) values
  ('react',                  'React',                       'developer', 'Web',      1),
  ('nextjs',                 'Next.js',                     'developer', 'Web',      2),
  ('vue',                    'Vue',                         'developer', 'Web',      3),
  ('flutter',                'Flutter',                     'developer', 'Mobile',   4),
  ('kotlin',                 'Kotlin',                      'developer', 'Mobile',   5),
  ('swift',                  'Swift',                       'developer', 'Mobile',   6),
  ('nodejs',                 'Node.js',                     'developer', 'Backend',  7),
  ('python',                 'Python',                      'developer', 'Backend',  8),
  ('go',                     'Go',                          'developer', 'Backend',  9),
  ('java',                   'Java',                        'developer', 'Backend', 10),
  ('figma',                  'Figma',                       'designer',  'Design',  11),
  ('mobile-app-design',      'Mobile App Design',           'designer',  'Design',  12),
  ('web-design',             'Web Design',                  'designer',  'Design',  13),
  ('design-systems',         'Design Systems',              'designer',  'Design',  14),
  ('meta-ads',               'Meta Ads',                    'marketer',  'Growth',  15),
  ('google-ads',             'Google Ads',                  'marketer',  'Growth',  16),
  ('seo',                    'SEO',                         'marketer',  'Growth',  17),
  ('vernacular-copywriting', 'Vernacular Copywriting',      'marketer',  'Content', 18),
  ('social-media-growth',    'Social Media Growth',         'marketer',  'Growth',  19);


-- ---------------------------------------------------------------------
-- 11. CRON (pg_cron). Skipped automatically if the extension is not enabled.
--     Enable it in Supabase: Database -> Extensions -> pg_cron, then re-run this block.
--     Times are UTC. IST = UTC+5:30.
-- ---------------------------------------------------------------------
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('devmap-expire-online',   '*/10 * * * *', $job$select private.expire_online_status()$job$);
    perform cron.schedule('devmap-ghost-resolve',   '*/10 * * * *', $job$select private.resolve_expired_ghost_reports()$job$);
    perform cron.schedule('devmap-velocity',        '5 * * * *',    $job$select private.recompute_all_velocities()$job$);
    perform cron.schedule('devmap-reset-caps',      '30 18 * * *',  $job$select private.reset_daily_caps()$job$);      -- 00:00 IST
    perform cron.schedule('devmap-rank-snapshot',   '0 19 * * *',   $job$select private.take_rank_snapshot()$job$);    -- 00:30 IST
    perform cron.schedule('devmap-purge',           '0 21 * * *',   $job$select private.purge_old_operational_data()$job$);
  end if;
end
$cron$;
