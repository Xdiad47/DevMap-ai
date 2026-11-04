\set ON_ERROR_STOP off
\pset pager off
\set QUIET on
-- Runs against a database that has the stub + ALL migrations + supabase/seed.sql loaded (15 mock talents).
-- Self-contained helpers (same pattern as 10_behavior_tests.sql).
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

-- ===== seed sanity =====
select t.ok((select count(*) from public.talent_public)=15,'S1 seed loaded 15 profiles');
select t.ok((select count(*) filter (where role='developer') from public.talent_public)=7
        and (select count(*) filter (where role='designer')  from public.talent_public)=4
        and (select count(*) filter (where role='marketer')  from public.talent_public)=4,'S2 role mix 7/4/4 (all three roles present)');
select t.ok((select count(distinct state) from public.talent_public)>=8 and (select count(distinct city) from public.talent_public)>=9,'S3 seed is spread across many states and cities, not one region');
select t.ok((select count(*) from public.talent_public where is_online)>=8 and (select count(*) from public.talent_public where not is_online)>=4,'S4 mix of Online and Offline');
select t.ok((select count(*) from public.talent_public where is_online and not is_listed)=0,'S5 every Online profile passes the listing gate');
select t.ok((select count(*) from public.talent_private where telegram_chat_id is null)=0,'S6 every seed profile has a (mock) Telegram chat id');
select t.ok((select count(*) from public.talent_public where is_listed)=15,'S7 all 15 are listed (phone verified + score > 0 or reviewed)');
select t.ok((select state_rank from public.talent_public where id='00000000-0000-4000-8000-000000000001') is not null,'S8 leaderboard ranks were computed by the real snapshot function');

-- ===== scores come from the real functions, not typed values =====
select t.ok((select proof_score from public.talent_public where id='00000000-0000-4000-8000-000000000001')=100,
        'S9 Rahul (work 40, 2 verified projects at 99%) -> proof 100', (select proof_score::text||' '||score_breakdown::text from public.talent_public where id='00000000-0000-4000-8000-000000000001'));
select t.ok((select proof_score from public.talent_public where id='00000000-0000-4000-8000-000000000005')=14,
        'S10 Nabanita (work 14, no projects, unverified) -> proof 14', (select proof_score::text from public.talent_public where id='00000000-0000-4000-8000-000000000005'));
select t.ok((select verified_live_apps from public.talent_public where id='00000000-0000-4000-8000-000000000001')=2,'S11 verified_live_apps maintained by triggers');

-- ===== visibility helper == RLS policy (they must never disagree) =====
select t.login(null,'anon');
select t.ok((select count(*) from public.talent_public)=15,'V1 anon sees the 15 listed profiles');
reset role;
update public.talent_public set is_paused=true where id='00000000-0000-4000-8000-000000000002';
update public.talent_public set is_banned=true where id='00000000-0000-4000-8000-000000000003';
update public.talent_public set suspended_until=now()+interval '3 days' where id='00000000-0000-4000-8000-000000000004';
select t.login(null,'anon');
select t.ok((select count(*) from public.talent_public)=12,'V2 paused, banned and suspended profiles disappear from anon reads');
reset role;
select t.ok((select count(*) from public.talent_public tp where private.talent_is_visible(tp))=12,'V3 private.talent_is_visible() agrees with the RLS policy (12 = 12)');
-- the visible set must be IDENTICAL, not just the same size
select t.ok(not exists (
  (select id from public.talent_public tp where private.talent_is_visible(tp))
  except
  (select id from (select id from public.talent_public where is_listed and not is_paused and not is_banned and deleted_at is null and (suspended_until is null or suspended_until <= now())) x)
),'V4 visible id sets are identical');

-- ===== unlock_quotes (batch) =====
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select t.ok(public.unlock_quotes(array(select id from public.talent_public))::text is not null,'Q0 authenticated can call unlock_quotes (no error)');
select t.ok((public.unlock_quotes(array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005']::uuid[]) -> '00000000-0000-4000-8000-000000000001' ->> 'credits')::int=2
        and (public.unlock_quotes(array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005']::uuid[]) -> '00000000-0000-4000-8000-000000000005' ->> 'credits')::int=1,
        'Q1 elite = 2 credits, standard = 1 credit');
select t.ok(public.unlock_quotes(array['00000000-0000-4000-8000-000000000002']::uuid[]) = '{}'::jsonb,'Q2 a paused profile gets no quote (nothing leaks about hidden profiles)');
select t.ok(public.unlock_quotes(array['00000000-0000-4000-8000-000000000015']::uuid[]) -> '00000000-0000-4000-8000-000000000015' ->> 'tier'='standard',
        'Q3 #15 has a high score but 10 idle days -> NOT Tier 1', (select composite_rank_score::text from public.talent_public where id='00000000-0000-4000-8000-000000000015'));
-- parity: batch == single-profile function for every visible profile
reset role;
select t.ok(not exists (
  select 1 from public.talent_public tp
  where private.talent_is_visible(tp)
    and (public.unlock_quotes(array[tp.id]) -> tp.id::text) is distinct from public.unlock_quote(tp.id)
),'Q4 unlock_quotes() == unlock_quote() for every visible profile');
select t.login(null,'anon');
select t.expect_error($$select public.unlock_quotes(array[gen_random_uuid()])$$,'permission denied','Q5 anon cannot call unlock_quotes');
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select t.ok(jsonb_typeof(public.unlock_quotes(array(select gen_random_uuid() from generate_series(1,500))))='object','Q6 oversized id list is capped, not an error');

-- ===== talent_project_titles =====
select t.ok((select count(*) from public.talent_project_titles(array['00000000-0000-4000-8000-000000000001']::uuid[]))=2,'P1 Rahul shows 2 verified project titles');
select t.ok((select count(*) from public.talent_project_titles(array['00000000-0000-4000-8000-000000000005']::uuid[]))=0,'P2 a talent with no verified projects shows none');
select t.ok(not exists (select 1 from public.talent_project_titles(array(select id from public.talent_public)) x
                        where x.generic_title ilike '%http%' or x.generic_title ilike '%example.invalid%'),'P4 titles never contain a URL');
reset role;
-- an UNVERIFIED project must never be shown
insert into public.projects(talent_id,generic_title,live_url) values ('00000000-0000-4000-8000-000000000005','Unverified claim app','https://claim.example.invalid');
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select t.ok((select count(*) from public.talent_project_titles(array['00000000-0000-4000-8000-000000000005']::uuid[]))=0,'P5 unverified projects are not shown');
select t.ok((select count(*) from public.projects)=0,'P6 recruiters read ZERO rows of the projects table: URLs stay hidden (RLS)');
reset role;
select t.login(null,'anon');
select t.expect_error($$select * from public.talent_project_titles(array[gen_random_uuid()])$$,'permission denied','P7 anon cannot call talent_project_titles');
reset role;
select t.ok((select count(*) from public.talent_project_titles(array['00000000-0000-4000-8000-000000000003']::uuid[]))=0,'P8 titles of a BANNED profile are hidden');

-- ===== summary =====
\set QUIET off
select 'TOTAL='||count(*)||'  PASS='||count(*) filter (where ok)||'  FAIL='||count(*) filter (where not ok) as summary from t.results;
select n, label, detail from t.results where not ok order by n;
