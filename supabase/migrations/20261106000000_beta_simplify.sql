-- =====================================================================
-- DevMap.in | BETA SIMPLIFICATION
--
-- Decisions: no SMS OTP and no Telegram bot while DevMap is a free beta.
--   * The WhatsApp number a person types is SELF-DECLARED. Recruiters tap it to open WhatsApp directly.
--     (The column is still called is_phone_verified: it now means "profile is complete and may be listed".)
--   * Talent are told about leads by e-mail, sent by the app. Nothing needs a bot or a chat id.
--   * A ghost report can no longer be answered over Telegram, so an expired report goes to a human
--     (the admin review queue) instead of being refunded automatically. Otherwise anyone could
--     unlock a number, then "report" it and get the credits back.
-- Nothing is dropped: the Telegram tables and functions stay dormant, so this migration is safe to re-run on a
-- database that already holds data, and Telegram can be switched back on later.
-- =====================================================================

-- 1. One shared function decides "verified". It is called by create_talent_profile and create_recruiter_profile.
create or replace function private.sync_phone_verification(p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_t   boolean := false;
  v_rid uuid;
  v_rtg timestamptz;
begin
  update public.talent_private tp
     set is_phone_verified = true
    from public.talent_public t
   where t.id = tp.talent_id and t.user_id = p_uid and t.deleted_at is null;
  v_t := found;

  update public.recruiters r
     set is_phone_verified = true
   where r.user_id = p_uid and r.deleted_at is null
  returning r.id, r.trial_granted_at into v_rid, v_rtg;

  -- one free preview, granted once, when the recruiter profile is created
  if v_rid is not null and v_rtg is null then
    update public.recruiters set trial_unlocks_remaining = 1, trial_granted_at = now() where id = v_rid;
    perform private.apply_credit_delta(v_rid, 0, 'trial_grant', v_rid);
  end if;

  return jsonb_build_object('talent_verified', v_t, 'recruiter_verified', v_rid is not null);
end $$;

comment on column public.talent_private.is_phone_verified is 'Beta: true once the profile exists. The number is self-declared (no OTP).';
comment on column public.recruiters.is_phone_verified is 'Beta: true once the profile exists. The number is self-declared (no OTP).';

-- 1b. Recruiters give no phone number in the beta (they open WhatsApp from their own phone). NULLs do not collide in a unique column.
alter table public.recruiters alter column phone_e164 drop not null;

-- 2. Going Online no longer needs a linked Telegram chat.
create or replace function private.tg_talent_public_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_verified boolean;
begin
  if TG_OP = 'INSERT' or NEW.skills is distinct from OLD.skills then
    NEW.skills := coalesce((select array_agg(distinct s order by s) from unnest(NEW.skills) s), '{}');
    if exists (select 1 from unnest(NEW.skills) s(slug) left join public.skills k on k.slug = s.slug where k.slug is null) then
      raise exception 'unknown_skill';
    end if;
  end if;

  select p.is_phone_verified into v_verified
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


-- 3. Expired ghost reports go to a human. (Before: auto-upheld, because the talent could answer on Telegram.)
create or replace function private.resolve_expired_ghost_reports() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_n int := 0;
begin
  for r in select id, talent_id from public.ghost_reports
            where status = 'awaiting_talent' and talent_deadline < now()
            for update skip locked
  loop
    update public.ghost_reports set status = 'under_review' where id = r.id;
    insert into public.review_queue (talent_id, type, related_id, evidence_urls)
    values (r.talent_id, 'ghost_dispute', r.id, '{}');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
