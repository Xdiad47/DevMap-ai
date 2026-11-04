-- =====================================================================
-- DevMap.in | Sprint 3 | Telegram outbox + worker queues
--
-- WHY AN OUTBOX (and not "DB webhooks"): a message is queued in the SAME transaction as the thing that
-- caused it (unlock, ghost report, strike). If the Telegram API is down, the row stays and is retried; if the
-- app is down, nothing is lost. A DB webhook (pg_net) would need the database to reach our server, which
-- cannot be tested locally and drops events on failure.
--
-- Everything here is service_role only. Nothing in this file is reachable from a browser.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Outbox
-- ---------------------------------------------------------------------
create table public.telegram_outbox (
  id            uuid primary key default gen_random_uuid(),
  talent_id     uuid not null references public.talent_public(id) on delete cascade,
  kind          text not null check (kind in ('lead_alert', 'ghost_report', 'strike_notice', 'weekly_checkin', 'rank_change')),
  dedupe_key    text not null unique,           -- "lead:<unlock id>", "checkin:2026-W45": enqueueing twice is a no-op
  payload       jsonb not null default '{}'::jsonb,   -- ids and numbers only; the message TEXT is built by the app
  not_before    timestamptz not null default now(),
  attempts      int  not null default 0,
  locked_until  timestamptz,                    -- lease: a crashed worker's rows become claimable again
  sent_at       timestamptz,
  failed_at     timestamptz,                    -- gave up (permanent error or attempts exhausted)
  last_error    text,
  tg_message_id bigint,                         -- lets a Telegram *reply* be matched back to the report it answers
  created_at    timestamptz not null default now()
);
create index telegram_outbox_due_idx on public.telegram_outbox (created_at) where sent_at is null and failed_at is null;
create index telegram_outbox_reply_idx on public.telegram_outbox (talent_id, tg_message_id) where tg_message_id is not null;

alter table public.telegram_outbox enable row level security;      -- no policies = no access for anon/authenticated
revoke all on public.telegram_outbox from anon, authenticated;

-- Queue a message, but only for a talent we can actually reach. Idempotent on dedupe_key.
create function private.enqueue_telegram(p_talent uuid, p_kind text, p_key text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.talent_private where talent_id = p_talent and telegram_chat_id is not null) then
    return;
  end if;
  insert into public.telegram_outbox (talent_id, kind, dedupe_key, payload)
  values (p_talent, p_kind, p_key, coalesce(p_payload, '{}'::jsonb))
  on conflict (dedupe_key) do nothing;
end $$;

-- ---------------------------------------------------------------------
-- 2. Triggers that queue the event messages
-- ---------------------------------------------------------------------
create function private.tg_outbox_lead() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.enqueue_telegram(NEW.talent_id, 'lead_alert', 'lead:' || NEW.id,
            jsonb_build_object('unlock_id', NEW.id, 'online', NEW.talent_online_at_unlock));
  return null;
end $$;
create trigger lead_unlocks_outbox after insert on public.lead_unlocks
  for each row execute function private.tg_outbox_lead();

create function private.tg_outbox_ghost() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.enqueue_telegram(NEW.talent_id, 'ghost_report', 'ghost:' || NEW.id,
            jsonb_build_object('report_id', NEW.id, 'deadline', NEW.talent_deadline));
  return null;
end $$;
create trigger ghost_reports_outbox after insert on public.ghost_reports
  for each row execute function private.tg_outbox_ghost();

create function private.tg_outbox_strike() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  select count(*) into v_n from public.strikes
   where talent_id = NEW.talent_id and status = 'active' and expires_at > now();
  perform private.enqueue_telegram(NEW.talent_id, 'strike_notice', 'strike:' || NEW.id,
            jsonb_build_object('strike_id', NEW.id, 'active_strikes', v_n));
  return null;
end $$;
create trigger strikes_outbox after insert on public.strikes
  for each row execute function private.tg_outbox_strike();

-- ---------------------------------------------------------------------
-- 3. Scheduled messages: Monday check-in + daily rank change (called by the dispatcher; safe to call often)
-- ---------------------------------------------------------------------
create function public.enqueue_scheduled_notifications(p_force_checkin boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ist     timestamp := now() at time zone 'Asia/Kolkata';
  v_checkin int := 0;
  v_rank    int := 0;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;

  -- Weekly "still available?" : Mondays (IST). One per talent per ISO week (dedupe key).
  if p_force_checkin or extract(isodow from v_ist) = 1 then
    with ins as (
      insert into public.telegram_outbox (talent_id, kind, dedupe_key, payload)
      select t.id, 'weekly_checkin', 'checkin:' || t.id || ':' || to_char(v_ist, 'IYYY-"W"IW'), '{}'::jsonb
        from public.talent_public t
        join public.talent_private p on p.talent_id = t.id
       where p.telegram_chat_id is not null
         and t.is_listed and not t.is_paused and not t.is_banned and t.deleted_at is null
         and (t.suspended_until is null or t.suspended_until <= now())
      on conflict (dedupe_key) do nothing
      returning 1)
    select count(*) into v_checkin from ins;
  end if;

  -- Rank changes since yesterday's snapshot (view rank_moves). Skipped if the snapshot is stale (cron down).
  with ins as (
    insert into public.telegram_outbox (talent_id, kind, dedupe_key, payload)
    select m.talent_id, 'rank_change', 'rank:' || m.talent_id || ':' || m.recorded_on,
           jsonb_build_object('prev', m.prev_rank, 'new', m.new_rank, 'role', m.role, 'state', m.state)
      from public.rank_moves m
      join public.talent_private p on p.talent_id = m.talent_id
     where p.telegram_chat_id is not null
       and m.delta <> 0
       and m.recorded_on >= (v_ist::date - 1)
    on conflict (dedupe_key) do nothing
    returning 1)
  select count(*) into v_rank from ins;

  return jsonb_build_object('weekly_checkin', v_checkin, 'rank_change', v_rank);
end $$;

-- ---------------------------------------------------------------------
-- 4. Dispatcher primitives: claim -> (send) -> complete | fail
-- ---------------------------------------------------------------------
-- Quiet hours 22:00-07:00 IST for check-ins and rank changes. Lead alerts, ghost reports and strike notices are
-- exempt: a ghost report has a 12-hour clock that auto-upholds if the talent is silent, so deferring it to
-- 07:00 could cost someone a strike for sleeping. (PRD §13 exempted only lead alerts; see README.)
create function public.claim_telegram_outbox(p_limit int default 25)
returns table (id uuid, talent_id uuid, kind text, payload jsonb, chat_id bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare v_quiet boolean := extract(hour from (now() at time zone 'Asia/Kolkata')) not between 7 and 21;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  return query
  with due as (
    select o.id
      from public.telegram_outbox o
     where o.sent_at is null and o.failed_at is null
       and o.attempts < 5
       and o.not_before <= now()
       and (o.locked_until is null or o.locked_until < now())
       and (o.kind in ('lead_alert', 'ghost_report', 'strike_notice') or not v_quiet)
     order by o.created_at
     limit greatest(1, least(coalesce(p_limit, 25), 100))
       for update skip locked
  ), claimed as (
    update public.telegram_outbox o
       set attempts = o.attempts + 1, locked_until = now() + interval '2 minutes'
      from due where o.id = due.id
    returning o.id, o.talent_id, o.kind, o.payload
  )
  select c.id, c.talent_id, c.kind, c.payload, p.telegram_chat_id
    from claimed c
    left join public.talent_private p on p.talent_id = c.talent_id;
end $$;

create function public.complete_telegram_outbox(p_id uuid, p_message_id bigint default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.telegram_outbox%rowtype;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  update public.telegram_outbox
     set sent_at = coalesce(sent_at, now()), tg_message_id = p_message_id, locked_until = null, last_error = null
   where id = p_id
  returning * into v;
  if found and v.kind = 'lead_alert' then
    update public.lead_unlocks set talent_notified_at = coalesce(talent_notified_at, now())
     where id = (v.payload ->> 'unlock_id')::uuid;
  end if;
end $$;

-- p_permanent: Telegram said "never" (blocked the bot, chat not found) or there is no chat id any more.
-- p_retry_after_seconds: Telegram's own 429 hint; otherwise back off 1, 4, 9, 16 minutes.
create function public.fail_telegram_outbox(p_id uuid, p_error text, p_permanent boolean default false,
                                            p_retry_after_seconds int default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  update public.telegram_outbox
     set last_error   = left(p_error, 300),
         failed_at    = case when p_permanent or attempts >= 5 then now() end,
         locked_until = now() + make_interval(secs => coalesce(p_retry_after_seconds, 60 * attempts * attempts))
   where id = p_id and sent_at is null;
end $$;

-- A Telegram message the talent REPLIED to -> which of our messages was it? (ghost-report dispute flow)
create function public.find_outbox_for_reply(p_chat_id bigint, p_message_id bigint)
returns table (kind text, payload jsonb, talent_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.kind, o.payload, o.talent_id
    from public.telegram_outbox o
    join public.talent_private p on p.talent_id = o.talent_id
   where p.telegram_chat_id = p_chat_id and o.tg_message_id = p_message_id and o.sent_at is not null
   order by o.created_at desc
   limit 1
$$;

-- ---------------------------------------------------------------------
-- 5. GitHub scorer queue
-- ---------------------------------------------------------------------
-- Developers due for a (re)score, oldest first. Seed/mock profiles are excluded: 'mock-dev-1' could be a REAL
-- GitHub user, and we must never overwrite fake-but-deliberate seed scores with a stranger's commits.
create function public.github_scoring_queue(p_limit int default 20, p_min_age interval default '20 hours')
returns table (talent_id uuid, github_username text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, p.github_username
    from public.talent_public t
    join public.talent_private p on p.talent_id = t.id
   where t.role = 'developer' and t.deleted_at is null and not t.is_banned
     and p.github_username is not null
     and not (t.score_breakdown ? 'seed')
     and coalesce((t.score_breakdown ->> 'github_scored_at')::timestamptz, '-infinity') < now() - p_min_age
   order by coalesce((t.score_breakdown ->> 'github_scored_at')::timestamptz, '-infinity'), t.id
   limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

-- Failed lookup (user renamed / deleted / API error): remember WHEN so we don't retry every run, but never
-- change the existing work-depth. A GitHub outage must not zero anybody's score.
create function public.record_github_failure(p_talent uuid, p_error text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  update public.talent_public
     set score_breakdown = score_breakdown || jsonb_build_object('github_scored_at', now(), 'github_error', left(p_error, 120))
   where id = p_talent and role = 'developer';
end $$;

-- ---------------------------------------------------------------------
-- 6. Ownership verification + uptime pings
-- ---------------------------------------------------------------------
alter table public.projects
  add column next_ping_at        timestamptz,      -- randomised: now + 3h..9h after each ping (mean 6h = ~4 pings/day)
  add column verify_attempted_at timestamptz;

-- Unverified projects, 14 days after creation the worker gives up (delete + re-add to retry). One attempt/hour.
create function public.claim_verification_batch(p_limit int default 20)
returns table (project_id uuid, live_url text, repo_url text, verification_token text, github_username text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  return query
  with due as (
    select pr.id
      from public.projects pr
      join public.talent_public t on t.id = pr.talent_id
     where not pr.is_ownership_verified
       and pr.created_at > now() - interval '14 days'
       and (pr.verify_attempted_at is null or pr.verify_attempted_at < now() - interval '1 hour')
       and t.deleted_at is null and not t.is_banned
       and not (t.score_breakdown ? 'seed')          -- fake dev data: its .invalid domains can never be fetched
     order by pr.verify_attempted_at nulls first, pr.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 100))
       for update of pr skip locked
  ), claimed as (
    update public.projects pr set verify_attempted_at = now()
      from due where pr.id = due.id
    returning pr.id, pr.live_url, pr.repo_url, pr.verification_token, pr.talent_id
  )
  select c.id, c.live_url, c.repo_url, c.verification_token, p.github_username
    from claimed c
    left join public.talent_private p on p.talent_id = c.talent_id;
end $$;

create function public.mark_project_verified(p_project uuid, p_method public.verification_method) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if p_method not in ('github_homepage', 'well_known_file') then raise exception 'invalid_method'; end if;
  begin
    update public.projects
       set is_ownership_verified = true, verification_method = p_method,
           verified_at = coalesce(verified_at, now()), next_ping_at = null    -- null = ping right away
     where id = p_project and not is_ownership_verified;
  exception when unique_violation then
    raise exception 'url_already_verified';     -- another talent verified this URL first (unique index)
  end;
end $$;

-- Verified projects due for a ping. The lease (+10 min) stops two overlapping worker runs pinging the same site.
create function public.claim_ping_batch(p_limit int default 50)
returns table (project_id uuid, live_url text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  return query
  with due as (
    select pr.id
      from public.projects pr
      join public.talent_public t on t.id = pr.talent_id
     where pr.is_ownership_verified
       and (pr.next_ping_at is null or pr.next_ping_at <= now())
       and t.deleted_at is null and not t.is_banned
       and not (t.score_breakdown ? 'seed')          -- pinging fake dev domains would only erode the seed data
     order by pr.next_ping_at nulls first
     limit greatest(1, least(coalesce(p_limit, 50), 200))
       for update of pr skip locked
  ), claimed as (
    update public.projects pr set next_ping_at = now() + interval '10 minutes'
      from due where pr.id = due.id
    returning pr.id, pr.live_url
  )
  select c.id, c.live_url from claimed c;
end $$;

-- Insert one ping result (the existing trigger recomputes uptime + proof) and schedule the next one at random.
create function public.record_ping(p_project uuid, p_http_status int, p_latency_ms int, p_is_up boolean,
                                   p_error text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  insert into public.ping_results (project_id, http_status, latency_ms, is_up, error)
  values (p_project, p_http_status, p_latency_ms, p_is_up, left(p_error, 120));
  update public.projects
     set next_ping_at = now() + interval '3 hours' + random() * interval '6 hours'
   where id = p_project;
end $$;

-- ---------------------------------------------------------------------
-- 7. Housekeeping: also purge old outbox rows
-- ---------------------------------------------------------------------
create or replace function private.purge_old_operational_data() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.ping_results where checked_at < now() - interval '60 days';
  delete from public.telegram_link_tokens where expires_at < now() - interval '1 day';
  delete from public.telegram_outbox where coalesce(sent_at, failed_at) < now() - interval '30 days';
  update public.client_attestations set status = 'expired' where status = 'pending' and expires_at < now();
  -- NOTE: payments, credits_ledger, lead_unlocks, consents are retained 7 years (see PRD §12).
end $$;

-- ---------------------------------------------------------------------
-- 8. Permissions: service_role only
-- ---------------------------------------------------------------------
revoke execute on function
  public.enqueue_scheduled_notifications(boolean),
  public.claim_telegram_outbox(int),
  public.complete_telegram_outbox(uuid, bigint),
  public.fail_telegram_outbox(uuid, text, boolean, int),
  public.find_outbox_for_reply(bigint, bigint),
  public.github_scoring_queue(int, interval),
  public.record_github_failure(uuid, text),
  public.claim_verification_batch(int),
  public.mark_project_verified(uuid, public.verification_method),
  public.claim_ping_batch(int),
  public.record_ping(uuid, int, int, boolean, text)
  from public, anon, authenticated;

grant execute on function
  public.enqueue_scheduled_notifications(boolean),
  public.claim_telegram_outbox(int),
  public.complete_telegram_outbox(uuid, bigint),
  public.fail_telegram_outbox(uuid, text, boolean, int),
  public.find_outbox_for_reply(bigint, bigint),
  public.github_scoring_queue(int, interval),
  public.record_github_failure(uuid, text),
  public.claim_verification_batch(int),
  public.mark_project_verified(uuid, public.verification_method),
  public.claim_ping_batch(int),
  public.record_ping(uuid, int, int, boolean, text)
  to service_role;
grant select, insert, update, delete on public.telegram_outbox to service_role;
