\set ON_ERROR_STOP off
\pset pager off
\set QUIET on
-- Sprint 3: Telegram outbox + worker queues. Runs against a DB with the stub + ALL migrations + seed.sql loaded.
create schema t; grant usage on schema t to public;
create table t.results (n serial, label text, ok boolean, detail text);
grant all on t.results to public; grant usage on sequence t.results_n_seq to public;
create function t.ok(p_ok boolean, p_label text, p_detail text default null) returns void language plpgsql as $$
begin
  insert into t.results(label, ok, detail) values (p_label, coalesce(p_ok,false), p_detail);
  raise notice '% % %', case when coalesce(p_ok,false) then 'PASS' else 'FAIL' end, p_label, coalesce(p_detail,'');
end $$;
create function t.login(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', p_role)::text, false);
  perform set_config('role', p_role, false);
end $$;
create function t.expect_error(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql; perform t.ok(false, p_label, 'NO ERROR RAISED');
  exception when others then perform t.ok(sqlerrm ilike '%'||p_pattern||'%', p_label, case when sqlerrm ilike '%'||p_pattern||'%' then null else 'got: '||sqlerrm end);
  end;
end $$;

\set t1 '00000000-0000-4000-8000-000000000001'
\set t2 '00000000-0000-4000-8000-000000000002'
\set t3 '00000000-0000-4000-8000-000000000003'
\set t5 '00000000-0000-4000-8000-000000000005'
\set t6 '00000000-0000-4000-8000-000000000006'
\set t7 '00000000-0000-4000-8000-000000000007'

-- helper: a recruiter + an unlock of a given talent (inserted directly, like the other suites)
create function t.fake_unlock(p_talent uuid, p_online boolean default true) returns uuid language plpgsql as $$
declare r uuid; u uuid;
begin
  insert into public.recruiters(phone_e164, is_phone_verified) values ('+91'||(floor(random()*9e9)+1e9)::bigint::text, true) returning id into r;
  insert into public.lead_unlocks(recruiter_id, talent_id, tier_at_unlock, credits_deducted, is_trial, talent_online_at_unlock,
        has_clicked_whatsapp, whatsapp_clicked_at)
  values (r, p_talent, 'standard', 1, false, p_online, true, now() - interval '30 hours') returning id into u;
  return u;
end $$;

-- ===================== A. lead alerts are queued in the same transaction =====================
select t.fake_unlock(:'t2') as u1 \gset
select t.ok((select count(*) from public.telegram_outbox where kind='lead_alert' and dedupe_key='lead:'||:'u1')=1,'A1 an unlock queues exactly one lead alert');
select t.ok((select (payload->>'unlock_id')::uuid = :'u1'::uuid and (payload->>'online')::boolean from public.telegram_outbox where dedupe_key='lead:'||:'u1'),'A2 payload carries the unlock id and the online flag');
select t.ok(not exists (select 1 from public.telegram_outbox where payload::text ilike '%@%' or payload::text ilike '%+91%'),'A3 payloads hold ids and numbers only: no contact data');
select private.enqueue_telegram(:'t2','lead_alert','lead:'||:'u1','{}'::jsonb);
select t.ok((select count(*) from public.telegram_outbox where dedupe_key='lead:'||:'u1')=1,'A4 enqueueing the same key twice is a no-op (idempotent)');

-- a talent we cannot reach gets nothing queued
update public.talent_private set telegram_chat_id = null where talent_id = :'t3';
select t.fake_unlock(:'t3') as u3 \gset
select t.ok((select count(*) from public.telegram_outbox where dedupe_key='lead:'||:'u3')=0,'A5 no Telegram chat linked -> nothing queued');
update public.talent_private set telegram_chat_id = -1000000003 where talent_id = :'t3';

-- ===================== B. claim / complete / fail =====================
select t.login(null,'anon');
select t.expect_error($$select * from public.claim_telegram_outbox(5)$$,'permission denied','B0 anon cannot call claim_telegram_outbox');
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select t.expect_error($$select * from public.claim_telegram_outbox(5)$$,'permission denied','B0b a signed-in user cannot either');
select t.expect_error($$select * from public.telegram_outbox$$,'permission denied','B0c nor read the outbox table');
reset role;

select t.login(null,'service_role');
create temp table claimed as select * from public.claim_telegram_outbox(50);
select count(*) as n_claimed from claimed \gset
select t.ok(:n_claimed >= 1,'B1 service role claims due rows', :'n_claimed');
select t.ok((select attempts=1 and locked_until > now() from public.telegram_outbox where dedupe_key='lead:'||:'u1'),'B2 a claimed row is leased and its attempt counted');
select t.ok((select count(*) from public.claim_telegram_outbox(50) where id=(select id from public.telegram_outbox where dedupe_key='lead:'||:'u1'))=0,'B3 a leased row is NOT handed out twice');
select t.ok((select chat_id from claimed where id=(select id from public.telegram_outbox where dedupe_key='lead:'||:'u1'))=-1000000002,'B4 the claim returns the chat id of the right talent');
select id as oid from public.telegram_outbox where dedupe_key='lead:'||:'u1' \gset
select public.complete_telegram_outbox(:'oid', 4242);
reset role;
select t.ok((select sent_at is not null and tg_message_id=4242 and locked_until is null from public.telegram_outbox where id=:'oid'),'B5 complete marks sent and stores the Telegram message id');
select t.ok((select talent_notified_at is not null from public.lead_unlocks where id=:'u1'),'B6 completing a lead alert stamps lead_unlocks.talent_notified_at');

-- transient failure: backoff, still retryable
select t.fake_unlock(:'t5') as u5 \gset
select id as oid5 from public.telegram_outbox where dedupe_key='lead:'||:'u5' \gset
select t.login(null,'service_role');
select count(*) as dummy from public.claim_telegram_outbox(100) \gset
select public.fail_telegram_outbox(:'oid5','timeout');
reset role;
select t.ok((select failed_at is null and last_error='timeout' and locked_until > now() from public.telegram_outbox where id=:'oid5'),'B7 transient failure keeps the row for retry with a backoff');
-- exhausted attempts -> given up
update public.telegram_outbox set attempts=5, locked_until=null where id=:'oid5';
select t.login(null,'service_role'); select public.fail_telegram_outbox(:'oid5','timeout'); reset role;
select t.ok((select failed_at is not null from public.telegram_outbox where id=:'oid5'),'B8 after 5 attempts the row is marked failed');
-- permanent failure straight away
select t.fake_unlock(:'t6') as u6 \gset
select id as oid6 from public.telegram_outbox where dedupe_key='lead:'||:'u6' \gset
select t.login(null,'service_role'); select public.fail_telegram_outbox(:'oid6','bot was blocked by the user', true); reset role;
select t.ok((select failed_at is not null from public.telegram_outbox where id=:'oid6'),'B9 a permanent failure (bot blocked) stops retrying immediately');
select t.login(null,'service_role');
select t.ok((select count(*) from public.claim_telegram_outbox(100) where id in (:'oid5'::uuid, :'oid6'::uuid))=0,'B10 failed rows are never claimed again');
reset role;

-- ===================== C. ghost reports and strikes queue notices (exempt from quiet hours) =====================
insert into public.recruiters(phone_e164, is_phone_verified) values ('+919111100001', true) returning id as rr \gset
insert into public.lead_unlocks(recruiter_id, talent_id, tier_at_unlock, credits_deducted, is_trial, talent_online_at_unlock, has_clicked_whatsapp, whatsapp_clicked_at)
  values (:'rr', :'t7', 'standard', 1, false, true, true, now() - interval '30 hours') returning id as ug \gset
insert into public.ghost_reports(unlock_id, recruiter_id, talent_id, talent_deadline)
  values (:'ug', :'rr', :'t7', now() + interval '12 hours') returning id as rep \gset
select t.ok((select count(*) from public.telegram_outbox where kind='ghost_report' and (payload->>'report_id')::uuid=:'rep'::uuid)=1,'C1 a ghost report queues a notice for the talent');
select t.ok((select payload ? 'deadline' from public.telegram_outbox where dedupe_key='ghost:'||:'rep'),'C2 the notice carries the deadline');
select private.apply_strike(:'t7', :'rep');
select t.ok((select (payload->>'active_strikes')::int=1 from public.telegram_outbox where kind='strike_notice' and talent_id=:'t7'),'C3 a strike queues a notice with the active-strike count');

-- quiet hours: check-ins wait, event notices never do
select t.login(null,'service_role');
select public.enqueue_scheduled_notifications(true) as cnt \gset
reset role;
select t.ok((:'cnt'::jsonb->>'weekly_checkin')::int >= 1,'C4 forced check-in run queues check-ins', :'cnt');
select t.login(null,'service_role');
select count(*) filter (where kind='weekly_checkin') as n_ci, count(*) filter (where kind in ('ghost_report','strike_notice')) as n_ev
  from public.claim_telegram_outbox(100) \gset
reset role;
select t.ok(:n_ev >= 0 and (case when extract(hour from (now() at time zone 'Asia/Kolkata')) between 7 and 21 then :n_ci >= 1 else :n_ci = 0 end),
  'C5 check-ins are claimed only outside 22:00-07:00 IST (now: '||to_char(now() at time zone 'Asia/Kolkata','HH24:MI')||')', 'ci='||:n_ci);
-- the exemption itself, independent of wall-clock: event notices were claimable (they were just claimed above or earlier)
select t.ok((select count(*) from public.telegram_outbox where kind in ('ghost_report','strike_notice') and attempts >= 1)=2,'C6 ghost + strike notices are claimed regardless of the hour');

-- ===================== D. weekly check-in + rank change =====================
select t.ok((select count(*) from public.telegram_outbox where kind='weekly_checkin') =
            (select count(*) from public.talent_public t join public.talent_private p on p.talent_id=t.id
              where p.telegram_chat_id is not null and t.is_listed and not t.is_paused and not t.is_banned and t.deleted_at is null
                and (t.suspended_until is null or t.suspended_until <= now())),'D1 every listed, reachable, active talent gets exactly one check-in');
select t.login(null,'service_role');
select public.enqueue_scheduled_notifications(true) as cnt2 \gset
reset role;
select t.ok((:'cnt2'::jsonb->>'weekly_checkin')::int = 0,'D2 running it again the same week queues nothing (dedupe)');

-- paused talent is skipped
update public.talent_public set is_paused = true where id = :'t6';
delete from public.telegram_outbox where kind='weekly_checkin';
select t.login(null,'service_role'); select public.enqueue_scheduled_notifications(true); reset role;
select t.ok((select count(*) from public.telegram_outbox where kind='weekly_checkin' and talent_id=:'t6')=0,'D3 paused talent is not nagged');
update public.talent_public set is_paused = false where id = :'t6';

-- rank change: yesterday #3, today #1
insert into public.rank_snapshots(talent_id, role, state, rank, cohort_size, score, recorded_on)
  select id, role, state, 3, 7, 80, (now() at time zone 'Asia/Kolkata')::date - 1 from public.talent_public where id=:'t1';
select t.ok((select delta from public.rank_moves where talent_id=:'t1')=-2,'D4 the rank_moves view sees #3 -> #1 (delta -2)');
select t.login(null,'service_role');
select public.enqueue_scheduled_notifications(false) as cnt3 \gset
reset role;
select t.ok((:'cnt3'::jsonb->>'rank_change')::int = 1,'D5 one rank-change message queued', :'cnt3');
select t.ok((select (payload->>'prev')::int=3 and (payload->>'new')::int=1 from public.telegram_outbox where kind='rank_change' and talent_id=:'t1'),'D6 payload has previous and new rank');
select t.login(null,'service_role');
select public.enqueue_scheduled_notifications(false) as cnt4 \gset
reset role;
select t.ok((:'cnt4'::jsonb->>'rank_change')::int = 0,'D7 rank change is queued once per snapshot day');

-- ===================== E. reply matching (ghost dispute by replying to the notice) =====================
select id as goid from public.telegram_outbox where dedupe_key='ghost:'||:'rep' \gset
select t.login(null,'service_role');
select public.complete_telegram_outbox(:'goid', 9001);
select t.ok((select kind='ghost_report' and (payload->>'report_id')::uuid=:'rep'::uuid from public.find_outbox_for_reply(-1000000007, 9001)),'E1 a reply is matched to the ghost report it answers');
select t.ok((select count(*) from public.find_outbox_for_reply(-1000000002, 9001))=0,'E2 another chat cannot claim that message id');
select t.ok((select count(*) from public.find_outbox_for_reply(-1000000007, 1))=0,'E3 unknown message id -> nothing');
reset role;

-- ===================== F. GitHub scorer queue =====================
select t.login(null,'service_role');
select t.ok((select count(*) from public.github_scoring_queue(50))=0,'F1 seed/mock developers are NEVER queued (mock-dev-N could be a real GitHub user)');
reset role;
update public.talent_public set score_breakdown = score_breakdown - 'seed' where id = :'t5';      -- pretend #5 is a real developer
select t.login(null,'service_role');
select t.ok((select github_username from public.github_scoring_queue(50) where talent_id=:'t5')='mock-dev-5','F2 a real developer with a GitHub username is queued');
select public.set_work_depth_from_commits(:'t5', 45, now() - interval '2 days', jsonb_build_object('github_scored_at', now()));
reset role;
select t.ok((select (score_breakdown->>'work_depth')::int = 31 and (score_breakdown->>'commits_90d')::int = 45 from public.talent_public where id=:'t5'),'F3 45 commits -> 31 work-depth points (PRD curve)');
select t.login(null,'service_role');
select t.ok((select count(*) from public.github_scoring_queue(50) where talent_id=:'t5')=0,'F4 just-scored developers wait ~20h before the next run');
reset role;
update public.talent_public set score_breakdown = score_breakdown || jsonb_build_object('github_scored_at', now() - interval '21 hours') where id=:'t5';
select t.login(null,'service_role');
select t.ok((select count(*) from public.github_scoring_queue(50) where talent_id=:'t5')=1,'F5 ...and are queued again after that');
select public.record_github_failure(:'t5','not_found');
reset role;
select t.ok((select (score_breakdown->>'work_depth')::int = 31 and score_breakdown->>'github_error'='not_found' from public.talent_public where id=:'t5'),'F6 a failed lookup records the error but keeps the existing score');
select t.login(null,'service_role');
select t.ok((select count(*) from public.github_scoring_queue(50) where talent_id=:'t5')=0,'F7 ...and does not retry on every run');
select t.expect_error(format('select public.set_work_depth_from_commits(%L, 10, now())', :'t7'),'developer_profile_required','F8 designers are not scored from commits');
reset role;

-- ===================== G. verification + pings =====================
select t.login(null,'service_role');
select t.ok((select count(*) from public.claim_ping_batch(200))=0,'G1 seed sites are never pinged (their .invalid domains can never resolve and would erode the seed data)');
select t.ok((select count(*) from public.claim_verification_batch(200))=0,'G2 ...nor verified');
reset role;

-- unverified projects are never pinged
insert into public.projects(talent_id, generic_title, live_url) values (:'t5','Real e-commerce site','https://shop.example.test') returning id as pu, verification_token as ptoken \gset
update public.projects set next_ping_at = null;
select t.login(null,'service_role');
select t.ok((select count(*) from public.claim_ping_batch(200) where project_id=:'pu')=0,'G4 an unverified project is not pinged');

select project_id, github_username as ghu from public.claim_verification_batch(10) where project_id=:'pu' \gset
select t.ok(:'ghu'='mock-dev-5','G5 verification batch returns the project with its owner''s GitHub username');
select t.ok((select count(*) from public.claim_verification_batch(10) where project_id=:'pu')=0,'G6 verification retries at most hourly');
select t.expect_error(format('select public.mark_project_verified(%L, %L)', :'pu', 'client_attestation'),'invalid_method','G7 the worker cannot award attestation-level proof');
select t.expect_error(format('select public.mark_project_verified(%L, %L)', :'pu', 'none'),'invalid_method','G8 nor verify with method none');
select public.mark_project_verified(:'pu','well_known_file');
reset role;
select t.ok((select is_ownership_verified and verification_method='well_known_file' and verified_at is not null from public.projects where id=:'pu'),'G9 well_known_file verification recorded');
select t.ok((select (score_breakdown->>'verification')::int = 20 from public.talent_public where id=:'t5'),'G10 the existing trigger re-scored the talent: direct proof = 20 verification points');
select t.login(null,'service_role');
select count(*) as n_due from public.claim_ping_batch(200) where project_id=:'pu' \gset
reset role;
select t.ok(:n_due = 1,'G10b a newly verified project is due for its first ping immediately');
select t.ok((select next_ping_at between now() + interval '9 minutes' and now() + interval '11 minutes' from public.projects where id=:'pu'),'G10c ...and is leased for ~10 minutes while it is being pinged');
select t.login(null,'service_role');
select t.ok((select count(*) from public.claim_ping_batch(200))=0,'G10d a second worker run right away pings nothing (lease)');
reset role;
-- first verifier wins on a URL
insert into public.projects(talent_id, generic_title, live_url) values (:'t6','Copycat of a site','https://shop.example.test') returning id as pcopy \gset
select t.login(null,'service_role');
select t.expect_error(format('select public.mark_project_verified(%L, %L)', :'pcopy', 'well_known_file'),'url_already_verified','G11 a URL can be directly verified by only one talent');
reset role;

-- recording pings
select t.login(null,'service_role');
select public.record_ping(:'pu', 200, 120, true);
select public.record_ping(:'pu', null, 3500, false, 'timeout');
reset role;
select t.ok((select samples_30d=2 and uptime_30d=50.00 and is_up=false from public.projects where id=:'pu'),'G12 pings feed uptime through the existing trigger (1 up + 1 down = 50%)');
select t.ok((select next_ping_at between now() + interval '2 hours 59 minutes' and now() + interval '9 hours 1 minute' from public.projects where id=:'pu'),'G13 the next ping is scheduled 3-9 hours out (random)');
-- randomness really varies: schedule 30 times and expect several distinct minutes
create temp table spread(m int);
do $$ declare i int; pid uuid; begin
  select id into pid from public.projects where live_url='https://shop.example.test' and is_ownership_verified limit 1;
  for i in 1..30 loop
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform public.record_ping(pid, 200, 100, true);
    insert into spread select round(extract(epoch from (next_ping_at - now()))/60)::int from public.projects where id=pid;
  end loop;
end $$;
select t.ok((select count(distinct m) from spread) >= 10 and (select min(m) from spread) >= 179 and (select max(m) from spread) <= 541,'G15 the next-ping offset is genuinely randomised within 3h-9h', (select min(m)||'..'||max(m)||' min, '||count(distinct m)||' distinct' from spread));

-- an upheld/banned owner's sites are not pinged
update public.talent_public set is_banned = true where id = :'t5';
update public.projects set next_ping_at = null where id = :'pu';
select t.login(null,'service_role');
select t.ok((select count(*) from public.claim_ping_batch(200) where project_id=:'pu')=0,'G16 banned talent''s sites are not pinged');
reset role;

-- ===================== H. permissions on every new function =====================
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select t.expect_error($$select public.record_ping(gen_random_uuid(),200,1,true)$$,'permission denied','H1 authenticated cannot record pings (no fake uptime)');
select t.expect_error($$select public.mark_project_verified(gen_random_uuid(),'well_known_file')$$,'permission denied','H2 authenticated cannot mark projects verified');
select t.expect_error($$select * from public.github_scoring_queue(5)$$,'permission denied','H3 authenticated cannot read the scoring queue');
select t.expect_error($$select public.enqueue_scheduled_notifications(true)$$,'permission denied','H4 authenticated cannot trigger notifications');
select t.expect_error($$select public.complete_telegram_outbox(gen_random_uuid(),1)$$,'permission denied','H5 authenticated cannot complete outbox rows');
reset role;
select t.login(null,'anon');
select t.expect_error($$select * from public.claim_ping_batch(5)$$,'permission denied','H6 anon cannot claim pings');
select t.expect_error($$select * from public.find_outbox_for_reply(1,1)$$,'permission denied','H7 anon cannot look up outbox messages');
reset role;

-- ===================== I. housekeeping =====================
update public.telegram_outbox set sent_at = now() - interval '40 days' where id = :'oid';
select private.purge_old_operational_data();
select t.ok((select count(*) from public.telegram_outbox where id=:'oid')=0,'I1 purge removes outbox rows sent over 30 days ago');
select t.ok((select count(*) from public.telegram_outbox where kind='ghost_report')=1,'I2 ...and keeps recent ones');

-- ===== summary =====
\set QUIET off
select 'TOTAL='||count(*)||'  PASS='||count(*) filter (where ok)||'  FAIL='||count(*) filter (where not ok) as summary from t.results;
select n, label, detail from t.results where not ok order by n;
