-- =====================================================================
-- DevMap.in | Sprint 4 | admin review screens + client attestation
--
-- 1. Admin actions can be called with an ADMIN'S OWN SESSION (JWT app_metadata.role = 'admin'), not just the
--    service key, so reviewer_id in the audit trail is a real person. The functions already check private.is_admin();
--    this only adds the EXECUTE grant (a normal user now gets 'forbidden' instead of 'permission denied').
-- 2. Every admin action writes admin_audit_log.
-- 3. Designers/marketers actually enter the portfolio review queue (nothing queued them before).
-- 4. Client attestation: spam limits, a per-contact limit enforced at CONFIRMATION time, WhatsApp-channel
--    confirmations always spot-checked, a token-gated preview for the client's page, and a reject path for spot-checks.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Audit trail
-- ---------------------------------------------------------------------
create table public.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid,                                  -- auth.uid() of the admin; null = the service key itself
  action      text not null,
  target_type text not null,                         -- 'talent' | 'ghost_report' | 'review_item' | 'attestation'
  target_id   uuid,
  notes       text,
  created_at  timestamptz not null default now()
);
create index admin_audit_log_target_idx on public.admin_audit_log (target_type, target_id, created_at desc);
alter table public.admin_audit_log enable row level security;       -- no policy: nobody but the service role reads it
revoke all on public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to service_role;

create function private.audit(p_action text, p_type text, p_target uuid, p_notes text) returns void
language sql security definer set search_path = public, pg_temp as
$$ insert into public.admin_audit_log (admin_id, action, target_type, target_id, notes)
   values (auth.uid(), p_action, p_type, p_target, left(p_notes, 500)) $$;

-- ---------------------------------------------------------------------
-- 2. Admin functions (same signatures as migration 1, plus audit; restore also closes a pending ban review)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_talent_review(p_talent uuid, p_status public.review_tier, p_work_depth int,
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
  if not found then raise exception 'talent_not_found'; end if;
  perform private.recompute_proof(p_talent);
  if p_queue_id is not null then
    update public.review_queue
       set status = case when p_status = 'unverified' then 'rejected' else 'approved' end,
           reviewer_notes = p_notes, reviewer_id = auth.uid(), resolved_at = now()
     where id = p_queue_id;
  end if;
  perform private.audit('set_review:' || p_status || ':' || p_work_depth, 'talent', p_talent, p_notes);
end $$;

create or replace function public.admin_resolve_ghost_report(p_report uuid, p_uphold boolean, p_notes text default null,
                                                             p_queue_id uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.ghost_reports where id = p_report) then raise exception 'report_not_found'; end if;
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
  perform private.audit(case when p_uphold then 'uphold_report' else 'reject_report' end, 'ghost_report', p_report, p_notes);
end $$;

create or replace function public.admin_ban_talent(p_talent uuid, p_notes text default null, p_queue_id uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_phone text; v_gh text;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.talent_public where id = p_talent) then raise exception 'talent_not_found'; end if;
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
  perform private.audit('ban', 'talent', p_talent, p_notes);
end $$;

create or replace function public.admin_restore_talent(p_talent uuid, p_notes text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.talent_public where id = p_talent) then raise exception 'talent_not_found'; end if;
  update public.talent_public set is_banned = false, suspended_until = null where id = p_talent;
  update public.strikes set status = 'overturned' where talent_id = p_talent and status = 'active';
  -- a ban review still open for this person is answered by restoring them
  update public.review_queue
     set status = 'rejected', reviewer_notes = p_notes, reviewer_id = auth.uid(), resolved_at = now()
   where talent_id = p_talent and type = 'ban_review' and status in ('pending', 'in_review');
  perform private.recompute_response_velocity(p_talent);
  perform private.audit('restore', 'talent', p_talent, p_notes);
end $$;

-- Strike 3 reviewed and the human decided NOT to ban: close the item; the suspension simply runs its course.
create function public.admin_dismiss_ban_review(p_queue_id uuid, p_notes text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  update public.review_queue
     set status = 'rejected', reviewer_notes = p_notes, reviewer_id = auth.uid(), resolved_at = now()
   where id = p_queue_id and type = 'ban_review' and status in ('pending', 'in_review');
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'review_item_not_open'; end if;
  perform private.audit('dismiss_ban_review', 'review_item', p_queue_id, p_notes);
end $$;

-- Spot-check of a client attestation. Reject = the confirmation is void: the project loses its (attested) verification
-- unless another confirmed attestation still backs it. Direct proof (devmap-verify.txt / GitHub) is never touched.
create function public.admin_review_attestation(p_attestation uuid, p_approve boolean, p_notes text default null,
                                                p_queue_id uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a public.client_attestations%rowtype;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  select * into v_a from public.client_attestations where id = p_attestation for update;
  if not found then raise exception 'attestation_not_found'; end if;
  if not p_approve and v_a.status = 'confirmed' then
    update public.client_attestations set status = 'declined' where id = p_attestation;
    update public.projects
       set is_ownership_verified = false, verification_method = 'none', verified_at = null, next_ping_at = null
     where id = v_a.project_id and verification_method = 'client_attestation'
       and not exists (select 1 from public.client_attestations o
                        where o.project_id = v_a.project_id and o.status = 'confirmed' and o.id <> p_attestation);
  end if;
  if p_queue_id is not null then
    update public.review_queue set status = case when p_approve then 'approved' else 'rejected' end,
           reviewer_notes = p_notes, reviewer_id = auth.uid(), resolved_at = now()
     where id = p_queue_id and type = 'attestation_spotcheck';
  end if;
  perform private.audit(case when p_approve then 'approve_attestation' else 'reject_attestation' end, 'attestation', p_attestation, p_notes);
end $$;

-- ---------------------------------------------------------------------
-- 3. Designers / marketers enter the portfolio review queue
-- ---------------------------------------------------------------------
create function private.tg_enqueue_portfolio_review() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if NEW.role in ('designer', 'marketer') and NEW.review_status = 'unverified' then
    insert into public.review_queue (talent_id, type)
    values (NEW.id, case NEW.role when 'designer' then 'designer_portfolio' else 'marketer_portfolio' end);
  end if;
  return null;
end $$;
create trigger talent_public_review_enqueue after insert on public.talent_public
  for each row execute function private.tg_enqueue_portfolio_review();

-- everyone already waiting (seed profiles are pre-reviewed or flagged and are left alone)
insert into public.review_queue (talent_id, type)
select t.id, case t.role when 'designer' then 'designer_portfolio' else 'marketer_portfolio' end
  from public.talent_public t
 where t.role in ('designer', 'marketer') and t.review_status = 'unverified' and t.deleted_at is null
   and not (t.score_breakdown ? 'seed')
   and not exists (select 1 from public.review_queue q where q.talent_id = t.id and q.type in ('designer_portfolio', 'marketer_portfolio'));

-- ---------------------------------------------------------------------
-- 4. Client attestation
-- ---------------------------------------------------------------------
-- Same signature as migration 1. New: anti-spam limits (we send e-mail from OUR domain to addresses a talent typed).
create or replace function public.create_client_attestation(p_project uuid, p_channel text, p_contact_masked text,
                                                            p_contact_hmac text, p_token_hash text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_talent uuid;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  select talent_id into v_talent from public.projects where id = p_project;
  if v_talent is null then raise exception 'project_not_found'; end if;
  -- one client contact may attest at most 2 projects per 30 days (anti-collusion)
  if (select count(*) from public.client_attestations
       where contact_hmac = p_contact_hmac and status = 'confirmed' and created_at > now() - interval '30 days') >= 2 then
    raise exception 'attestor_limit_reached';
  end if;
  if (select count(*) from public.client_attestations where project_id = p_project and status = 'pending') >= 3 then
    raise exception 'too_many_pending';
  end if;
  -- anti-spam: one contact is asked at most 3 times a day, one talent sends at most 5 requests a day
  if (select count(*) from public.client_attestations
       where contact_hmac = p_contact_hmac and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'contact_rate_limited';
  end if;
  if (select count(*) from public.client_attestations a join public.projects pr on pr.id = a.project_id
       where pr.talent_id = v_talent and a.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'talent_rate_limited';
  end if;
  insert into public.client_attestations (project_id, channel, contact_masked, contact_hmac, token_hash)
  values (p_project, p_channel, p_contact_masked, p_contact_hmac, p_token_hash)
  returning id into v_id;
  return v_id;
end $$;

-- The client's click. New vs migration 1:
--   * 'limit_reached': the 2-per-30-days rule is enforced when the client CONFIRMS too, not only when the request was
--     created (otherwise many requests made up-front would all be confirmable)
--   * WhatsApp-channel confirmations are ALWAYS spot-checked: the talent carries that link, so it proves less
create or replace function public.respond_client_attestation(p_token text, p_confirm boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a public.client_attestations%rowtype; v_talent uuid;
begin
  select * into v_a from public.client_attestations
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and status = 'pending' and expires_at > now() for update;
  if not found then return 'invalid'; end if;

  if p_confirm and (select count(*) from public.client_attestations o
                     where o.contact_hmac = v_a.contact_hmac and o.status = 'confirmed' and o.id <> v_a.id
                       and o.responded_at > now() - interval '30 days') >= 2 then
    update public.client_attestations set status = 'declined', responded_at = now() where id = v_a.id;
    return 'limit_reached';
  end if;

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
    if v_a.channel = 'whatsapp' or random() < 0.10 then
      insert into public.review_queue (talent_id, type, related_id) values (v_talent, 'attestation_spotcheck', v_a.id);
    end if;
    return 'confirmed';
  end if;
  return 'declined';
end $$;

-- What the client sees before deciding. Token-gated (256-bit random token), read-only, exposes no contact data:
-- the talent's masked name, the generic project title and the site they are asked to vouch for.
create function public.attestation_preview(p_token text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('talent_name', t.masked_name, 'title', pr.generic_title, 'site', pr.live_url,
                            'expires_at', a.expires_at)
    from public.client_attestations a
    join public.projects pr on pr.id = a.project_id
    join public.talent_public t on t.id = pr.talent_id
   where a.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and a.status = 'pending' and a.expires_at > now() and t.deleted_at is null and not t.is_banned
$$;

-- ---------------------------------------------------------------------
-- 5. Strike notices carry the talent id (for the appeal e-mail subject)
-- ---------------------------------------------------------------------
create or replace function private.tg_outbox_strike() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  select count(*) into v_n from public.strikes
   where talent_id = NEW.talent_id and status = 'active' and expires_at > now();
  perform private.enqueue_telegram(NEW.talent_id, 'strike_notice', 'strike:' || NEW.id,
            jsonb_build_object('strike_id', NEW.id, 'talent_id', NEW.talent_id, 'active_strikes', v_n));
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 6. Permissions
-- ---------------------------------------------------------------------
revoke execute on function
  public.admin_dismiss_ban_review(uuid, text),
  public.admin_review_attestation(uuid, boolean, text, uuid),
  public.attestation_preview(text)
  from public, anon, authenticated;

-- Admin functions: callable by a signed-in user, but the first line of each body raises 'forbidden' unless the JWT is
-- the service role or has app_metadata.role = 'admin'. Anon still cannot even call them.
grant execute on function
  public.admin_set_talent_review(uuid, public.review_tier, int, text, uuid),
  public.admin_resolve_ghost_report(uuid, boolean, text, uuid),
  public.admin_ban_talent(uuid, text, uuid),
  public.admin_restore_talent(uuid, text),
  public.admin_dismiss_ban_review(uuid, text),
  public.admin_review_attestation(uuid, boolean, text, uuid)
  to authenticated, service_role;

grant execute on function public.attestation_preview(text) to anon, authenticated, service_role;
