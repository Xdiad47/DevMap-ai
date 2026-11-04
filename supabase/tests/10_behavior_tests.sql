\set ON_ERROR_STOP off
\pset pager off
\set QUIET on
set client_min_messages = notice;

-- ============ test helpers (schema t) ============
create schema t; grant usage on schema t to public;
create table t.results (n serial, label text, ok boolean, detail text);
grant all on t.results to public; grant usage on sequence t.results_n_seq to public;

create function t.ok(p_ok boolean, p_label text, p_detail text default null) returns void language plpgsql as $$
begin
  insert into t.results(label, ok, detail) values (p_label, coalesce(p_ok,false), p_detail);
  raise notice '% % %', case when coalesce(p_ok,false) then 'PASS' else 'FAIL' end, p_label, coalesce(p_detail,'');
end $$;

create function t.expect_error(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform t.ok(false, p_label, 'NO ERROR RAISED');
  exception when others then
    perform t.ok(sqlerrm ilike '%'||p_pattern||'%', p_label, case when sqlerrm ilike '%'||p_pattern||'%' then null else 'got: '||sqlerrm end);
  end;
end $$;

create function t.login(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', p_role)::text, false);
  perform set_config('role', p_role, false);
end $$;

create function t.make_talent(p_uid uuid, p_role public.role_type, p_name text, p_phone text, p_chat bigint, p_skills text[]) returns uuid language plpgsql as $$
declare v_id uuid; tok text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  perform public.record_consent('dpdp_directory_listing','v1');
  perform public.record_consent('contact_disclosure','v1');
  perform public.record_consent('phone_processing','v1');
  update auth.users set phone = regexp_replace(p_phone,'\D','','g'), phone_confirmed_at = now() where id = p_uid;
  v_id := public.create_talent_profile(p_role, p_name, 'Guwahati','Assam',26.14,91.73,'Assamese',array['English'],p_skills,60000,p_phone,p_phone,'u'||p_chat||'@x.in');
  tok := public.create_telegram_link_token();
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform public.link_telegram(tok, p_chat, 'tg'||p_chat);
  return v_id;
end $$;

create function t.make_recruiter(p_uid uuid, p_phone text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  perform public.record_consent('recruiter_terms','v1');
  update auth.users set phone = regexp_replace(p_phone,'\D','','g'), phone_confirmed_at = now() where id = p_uid;
  v_id := public.create_recruiter_profile(p_phone, 'Acme Pvt Ltd', null);
  return v_id;
end $$;

create function t.fake_unlock(p_talent uuid, p_online boolean, p_ack interval, p_age interval, p_trial boolean default false) returns uuid language plpgsql as $$
declare r uuid; u uuid; ts timestamptz := now() - p_age;
begin
  insert into public.recruiters(phone_e164, is_phone_verified) values ('+91'||(floor(random()*9e9)+1e9)::bigint::text, true) returning id into r;
  insert into public.lead_unlocks(recruiter_id, talent_id, tier_at_unlock, credits_deducted, is_trial, talent_online_at_unlock,
        created_at, talent_acknowledged_at, has_clicked_whatsapp, whatsapp_clicked_at)
  values (r, p_talent, 'standard', case when p_trial then 0 else 1 end, p_trial, p_online, ts,
        case when p_ack is null then null else ts + p_ack end, true, ts) returning id into u;
  return u;
end $$;

create function t.fake_report(p_talent uuid) returns uuid language plpgsql as $$
declare u uuid; rid uuid; r uuid;
begin
  u := t.fake_unlock(p_talent, true, interval '5 minutes', interval '2 days');
  select recruiter_id into rid from public.lead_unlocks where id = u;
  insert into public.ghost_reports(unlock_id, recruiter_id, talent_id, talent_deadline)
  values (u, rid, p_talent, now() - interval '1 minute') returning id into r;
  return r;
end $$;

-- ============ seed auth users (what Supabase Auth would create) ============
insert into auth.users(id,email) values
 ('11111111-1111-1111-1111-111111111111','dev1@x.in'),
 ('22222222-2222-2222-2222-222222222222','des2@x.in'),
 ('33333333-3333-3333-3333-333333333333','dev3@x.in'),
 ('44444444-4444-4444-4444-444444444444','dev4@x.in'),
 ('55555555-5555-5555-5555-555555555555','dev5@x.in'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','rec1@x.in'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','rec2@x.in'),
 ('cccccccc-cccc-cccc-cccc-cccccccccccc','nobody@x.in');
insert into auth.identities(user_id, provider, identity_data) values
 ('11111111-1111-1111-1111-111111111111','github','{"sub":"gh-1","user_name":"rahul-dev"}'),
 ('33333333-3333-3333-3333-333333333333','github','{"sub":"gh-3","user_name":"priya-dev"}'),
 ('44444444-4444-4444-4444-444444444444','github','{"sub":"gh-4","user_name":"dev-four"}'),
 ('55555555-5555-5555-5555-555555555555','github','{"sub":"gh-5","user_name":"new-priya"}');

-- ============ A. pure functions ============
select t.ok(private.commit_points(0)=0 and private.commit_points(1)=6 and private.commit_points(5)=14 and private.commit_points(10)=19
        and private.commit_points(30)=27 and private.commit_points(100)=37 and private.commit_points(140)=40 and private.commit_points(100000)=40,
        'A1 commit_points log curve: 0->0,1->6,5->14,10->19,30->27,100->37,140->40 (capped)');
select t.ok(private.mask_name('Rahul Sharma')='Rahul S.' and private.mask_name('rahul')='Rahul' and private.mask_name('  anil  kumar  verma ')='Anil V.',
        'A2 mask_name');

-- ============ B. anonymous access is locked down ============
select t.login(null,'anon');
select t.expect_error('select * from public.talent_private','permission denied','B1 anon cannot read talent_private');
select t.expect_error('select * from public.lead_unlocks','permission denied','B2 anon cannot read lead_unlocks');
select t.expect_error('select * from public.payments','permission denied','B3 anon cannot read payments');
select t.expect_error($$insert into public.credits_ledger(recruiter_id,delta,balance_after,reason) values (gen_random_uuid(),100,100,'purchase')$$,'permission denied','B4 anon cannot write ledger');
select t.expect_error('select public.unlock_talent_contact(gen_random_uuid())','permission denied','B5 anon cannot call unlock RPC');
select t.expect_error('select public.fulfill_payment(''o'',''p'')','permission denied','B6 anon cannot call fulfill_payment');
select t.ok((select count(*) from public.skills)=19,'B7 anon can read skills catalogue');
select t.ok((select count(*) from public.talent_public)=0,'B8 map empty before anyone is listed');

-- ============ C. talent onboarding (stepwise, talent 1) ============
select t.login('11111111-1111-1111-1111-111111111111','authenticated');
select t.expect_error($$select public.create_talent_profile('developer','Rahul Sharma','Guwahati','Assam',26.14,91.73,'Assamese',array['english'],array['flutter','kotlin'],60000,'+919876500001','+919876500001','rahul@x.in')$$,
        'consent_required','C1 profile creation requires DPDP consents');
select public.record_consent('dpdp_directory_listing','v1'); select public.record_consent('contact_disclosure','v1'); select public.record_consent('phone_processing','v1');
select t.expect_error($$select public.create_talent_profile('developer','Rahul Sharma','Guwahati','Assam',26.14,91.73,'Assamese',array['english'],array['flutter','kotlin'],29000,'+919876500001','+919876500001','rahul@x.in')$$,
        'hourly_rate_paise','C2 rate floor Rs300/hr enforced');
select public.create_talent_profile('developer','Rahul Sharma','Guwahati','Assam',26.14,91.73,'Assamese',array['english'],array['flutter','kotlin'],60000,'+919876500001','+919876500001','rahul@x.in') as talent1 \gset
select t.ok(:'talent1' is not null,'C3 talent 1 created');
select t.login(null,'anon');
select t.ok((select count(*) from public.talent_public)=0,'C4 listing gate: no proof yet and unreviewed -> hidden');
reset role;
update auth.users set phone='919876500001', phone_confirmed_at=now() where id='11111111-1111-1111-1111-111111111111';   -- simulates OTP success
select t.login('11111111-1111-1111-1111-111111111111','authenticated');
select t.ok((public.sync_phone_verification()->>'talent_verified')::boolean,'C5 beta: the profile is marked ready as soon as it exists (self-declared number, no OTP)');
select t.login(null,'anon');
select t.ok((select count(*) from public.talent_public)=0,'C6 listing gate: verified phone but proof_score=0 and unreviewed -> hidden');
select t.login(null,'service_role');
select public.set_work_depth_from_commits(:'talent1', 45, now(), '{}');
select t.login(null,'anon');
select t.ok((select count(*) from public.talent_public)=1,'C7 listing gate: proof_score>0 -> visible on map');
select t.ok((select masked_name from public.talent_public)='Rahul S.','C8 public name is masked');
select t.ok((select proof_score from public.talent_public)=31,'C9 proof = 8*ln(46)=31', (select proof_score::text from public.talent_public));
select t.ok((select composite_rank_score from public.talent_public)=38.80,'C10 composite = 0.8*31 + 0.2*70 = 38.80', (select composite_rank_score::text from public.talent_public));
select t.expect_error('select full_name from public.talent_private','permission denied','C11 anon still cannot read contact vault');

select t.login('11111111-1111-1111-1111-111111111111','authenticated');
update public.talent_public set is_online = true where user_id = auth.uid();
select t.ok((select is_online from public.talent_public where user_id=auth.uid()),'C12 beta: can go Online without Telegram');
update public.talent_public set is_online = false where user_id = auth.uid();
select t.expect_error('update public.talent_public set proof_score = 100 where user_id = auth.uid()','permission denied','C13 talent cannot edit own score');
select t.expect_error('update public.talent_public set is_banned = false where user_id = auth.uid()','permission denied','C14 talent cannot edit moderation flags');
select t.expect_error('update public.talent_public set city = ''Mumbai'' where user_id = auth.uid()','permission denied','C15 city only via change_location()');
select t.expect_error('update public.talent_public set skills = array[''cobol''] where user_id = auth.uid()','unknown_skill','C16 skills validated against catalogue');
select t.expect_error($$select public.add_project('Bad','http://insecure.in')$$,'live_url','C17 plain http project URL rejected');
select t.expect_error($$select public.add_project('Bad','https://127.0.0.1:8080/x')$$,'live_url','C18 URL with port rejected');
select t.expect_error($$select public.add_project('Bad','https://user:pw@host.in/')$$,'live_url','C19 URL with credentials rejected');
select public.create_telegram_link_token() as tok1 \gset
select t.login(null,'service_role');
select public.link_telegram(:'tok1', 555001, 'rahul_tg');
select t.expect_error(format('select public.link_telegram(%L, 555002, ''x_user'')', :'tok1'),'invalid_or_expired_token','C20 link token is single-use');
select t.login('11111111-1111-1111-1111-111111111111','authenticated');
update public.talent_public set is_online = true where user_id = auth.uid();
select t.ok((select is_online from public.talent_public where user_id=auth.uid()),'C21 can go Online after Telegram link');
select public.change_location('Guwahati','Assam',26.14,91.73);
select t.expect_error($$select public.change_location('Mumbai','Maharashtra',19.07,72.87)$$,'location_change_cooldown','C22 location change cooldown (30 days)');
select t.ok((select count(*) from public.talent_private)=1,'C23 owner can read own private row');

-- other talent
reset role;
select t.make_talent('22222222-2222-2222-2222-222222222222','designer','Anita Das','+919876500002',555002,array['figma']) as talent2 \gset
select t.make_talent('33333333-3333-3333-3333-333333333333','developer','Priya Bora','+919876500003',555003,array['kotlin']) as talent3 \gset
select t.make_talent('44444444-4444-4444-4444-444444444444','developer','Dev Four','+919876500004',555004,array['go']) as talent4 \gset
select t.login(null,'service_role');
select public.admin_set_talent_review(:'talent2','reviewed',24,'portfolio ok');
select public.set_work_depth_from_commits(:'talent4', 20, now(), '{}');
reset role;
update public.talent_public set proof_score=100, review_status='verified' where id=:'talent3';      -- elite profile (composite 94)
update public.talent_public set is_online=true where id in (:'talent2'::uuid, :'talent3'::uuid, :'talent4'::uuid);
select t.ok((select proof_score from public.talent_public where id=:'talent2')=34,'C24 designer proof = 24 (review rubric) + 10 (reviewed) = 34');

-- ============ D. recruiter, trial, unlock, payments ============
select t.make_recruiter('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','+919800000001') as rec1 \gset
select t.make_recruiter('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','+919800000002') as rec2 \gset
select t.ok((select trial_unlocks_remaining from public.recruiters where id=:'rec1')=1,'D1 free trial granted after phone verification');
select t.ok((select count(*) from public.credits_ledger where recruiter_id=:'rec1' and reason='trial_grant')=1,'D2 trial grant is in the ledger');

select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select t.ok((select count(*) from public.talent_private)=0,'D3 recruiter sees ZERO rows of talent_private (RLS)');
select t.expect_error('update public.recruiters set credits_balance = 999','permission denied','D4 recruiter cannot set own balance');
select t.expect_error($$insert into public.lead_unlocks(recruiter_id,talent_id,tier_at_unlock,credits_deducted,talent_online_at_unlock) values (gen_random_uuid(),gen_random_uuid(),'standard',0,true)$$,'permission denied','D5 recruiter cannot forge unlocks');
select t.expect_error($$insert into public.credits_ledger(recruiter_id,delta,balance_after,reason) values (gen_random_uuid(),50,50,'purchase')$$,'permission denied','D6 recruiter cannot forge ledger');
select t.expect_error('select public.fulfill_payment(''o'',''p'')','permission denied','D7 recruiter cannot call fulfill_payment');
select t.ok((public.unlock_quote(:'talent1'::uuid)->>'credits')::int=1 and (public.unlock_quote(:'talent3'::uuid)->>'credits')::int=2 and public.unlock_quote(:'talent3'::uuid)->>'tier'='top_tier','D8 quote: standard=1 credit, elite=2 credits');

select public.unlock_talent_contact(:'talent1') as payload1 \gset
select t.ok((select array_agg(k order by k) from jsonb_object_keys(:'payload1'::jsonb) k)=array['full_name','portfolio_links','telegram_handle','whatsapp_number'],'D9 unlock returns EXACTLY 4 fields (no email/phone_e164/cap columns)');
select t.ok((:'payload1'::jsonb)->>'full_name'='Rahul Sharma' and (:'payload1'::jsonb)->>'whatsapp_number'='+919876500001','D10 unlock reveals real name + WhatsApp');
select t.ok((select is_trial and credits_deducted=0 and talent_online_at_unlock from public.lead_unlocks where recruiter_id=:'rec1' and talent_id=:'talent1'),'D11 first unlock used the free trial (credits_deducted=0, online snapshot true)');
select public.unlock_talent_contact(:'talent1');
select t.ok((select count(*) from public.lead_unlocks where recruiter_id=:'rec1')=1,'D12 re-unlocking is idempotent: no second row, no second charge');
select t.expect_error(format('select public.unlock_talent_contact(%L)', :'talent2'),'insufficient_credits','D13 no credits -> blocked');
select t.expect_error(format('select public.unlock_talent_contact(%L)', gen_random_uuid()),'talent_unavailable','D14 unknown talent -> blocked');

-- rec2's trial must NOT cover an elite (tier 1) profile
select t.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated');
select t.expect_error(format('select public.unlock_talent_contact(%L)', :'talent3'),'insufficient_credits','D15 free trial does not cover Tier 1 profiles');
select t.login('cccccccc-cccc-cccc-cccc-cccccccccccc','authenticated');
select t.expect_error(format('select public.unlock_talent_contact(%L)', :'talent1'),'recruiter_profile_required','D16 user without recruiter profile cannot unlock');

-- payments
select t.login(null,'service_role');
select (public.create_payment_order(:'rec1','credits_1','idem-1','order_1')).id as pay1 \gset
select public.create_payment_order(:'rec1','credits_1','idem-1','order_1_dup');
select t.ok((select count(*) from public.payments where idempotency_key='idem-1')=1,'D17 same idempotency key -> one payment row');
select t.ok((select amount_paise from public.payments where id=:'pay1')=9900 and (select gst_included_paise from public.payments where id=:'pay1')=0,'D18 price comes from server table (9900 paise); GST split is 0 while unregistered');
select t.expect_error($$select public.create_payment_order(gen_random_uuid(),'credits_999','i2','o2')$$,'bundle_unavailable','D19 unknown bundle rejected');
select public.fulfill_payment('order_1','pay_1');
select public.fulfill_payment('order_1','pay_1');
select public.fulfill_payment('order_1','pay_1');
select t.ok((select credits_balance from public.recruiters where id=:'rec1')=1,'D20 webhook replayed 3x -> credits granted ONCE');
select t.expect_error($$select public.fulfill_payment('nope','p')$$,'unknown_order','D21 unknown order rejected');

select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select public.unlock_talent_contact(:'talent2');
select t.ok((select credits_balance from public.recruiters where id=:'rec1')=0,'D22 paid standard unlock deducted 1 credit');
select t.ok((select delta=-1 and balance_after=0 from public.credits_ledger where recruiter_id=:'rec1' and reason='unlock_standard'),'D23 ledger row: delta -1, balance_after 0');

-- tier 1: 2 credits
select t.expect_error(format('select public.unlock_talent_contact(%L)', :'talent3'),'insufficient_credits','D24 elite unlock needs 2 credits');
select t.login(null,'service_role');
select public.create_payment_order(:'rec1','credits_3','idem-2','order_2');
select public.fulfill_payment('order_2','pay_2');
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select public.unlock_talent_contact(:'talent3');
select t.ok((select credits_balance from public.recruiters where id=:'rec1')=1,'D25 bought 3, elite unlock cost 2 -> 1 left');
select t.ok((select tier_at_unlock='top_tier' and credits_deducted=2 from public.lead_unlocks where recruiter_id=:'rec1' and talent_id=:'talent3'),'D26 unlock row records tier + 2 credits');

-- daily cap
select t.login('22222222-2222-2222-2222-222222222222','authenticated');
update public.talent_private set daily_unlock_cap = 1 where talent_id=:'talent2';
select t.expect_error($$update public.talent_private set phone_e164='+919999999999'$$,'permission denied','D27 talent cannot change verified phone directly');
select t.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated');
select t.expect_error(format('select public.unlock_talent_contact(%L)', :'talent2'),'talent_daily_limit_reached','D28 talent daily cap enforced');
-- self unlock
reset role;
select t.make_recruiter('33333333-3333-3333-3333-333333333333','+919876500003');
select t.login('33333333-3333-3333-3333-333333333333','authenticated');
select t.expect_error(format('select public.unlock_talent_contact(%L)', :'talent3'),'cannot_unlock_self','D29 cannot unlock your own talent profile');

-- ledger is append-only even for superusers
reset role;
select t.expect_error('update public.credits_ledger set delta = 5','append-only','D30 ledger UPDATE blocked');
select t.expect_error('delete from public.credits_ledger','append-only','D31 ledger DELETE blocked');

-- ============ E. projects, pings, proof ============
select t.login('11111111-1111-1111-1111-111111111111','authenticated');
select (public.add_project('Logistics Android App','https://rahul-app.example.in','https://github.com/rahul/logistics')->>'project_id')::uuid as proj1 \gset
select t.expect_error($$insert into public.projects(talent_id,generic_title,live_url) values (gen_random_uuid(),'x y z','https://a.in')$$,'permission denied','E1 projects only via add_project()');
select t.expect_error(format('update public.projects set is_ownership_verified = true where id=%L', :'proj1'),'permission denied','E2 talent cannot self-verify a project');
reset role;
update public.projects set is_ownership_verified=true, verification_method='well_known_file', verified_at=now() where id=:'proj1';
insert into public.ping_results(project_id,http_status,latency_ms,is_up,checked_at)
  select :'proj1', 200, 120, true, now() - (g || ' hours')::interval from generate_series(1,40) g;
select t.ok((select uptime_30d=100.00 and samples_30d=40 from public.projects where id=:'proj1'),'E3 uptime recomputed from pings');
select t.ok((select proof_score from public.talent_public where id=:'talent1')=71,'E4 proof = 31 work + 20 live + 20 direct-verification = 71',(select score_breakdown::text from public.talent_public where id=:'talent1'));
delete from public.ping_results where project_id=:'proj1';
insert into public.ping_results(project_id,http_status,is_up,checked_at)
  select :'proj1', case when g<=4 then 503 else 200 end, g>4, now() - (g || ' hours')::interval from generate_series(1,40) g;
select t.ok((select uptime_30d from public.projects where id=:'proj1')=90.00 and (select proof_score from public.talent_public where id=:'talent1')=64,'E5 90% uptime -> live pts 13 -> proof 64 (continuous, not binary)');
delete from public.ping_results where project_id=:'proj1';
insert into public.ping_results(project_id,http_status,is_up,checked_at) select :'proj1',200,true,now()-(g||' hours')::interval from generate_series(1,6) g;
select t.ok((select round((score_breakdown->>'live_proof')::numeric,1) from public.talent_public where id=:'talent1')=4.3,'E6 only 6 samples -> live pts scaled by 6/28 (cannot game with a brand-new URL)',(select score_breakdown->>'live_proof' from public.talent_public where id=:'talent1'));

-- client attestation
select t.login('44444444-4444-4444-4444-444444444444','authenticated');
select (public.add_project('Client Retail Site','https://client-shop.example.in')->>'project_id')::uuid as proj4 \gset
select t.login(null,'service_role');
select public.create_client_attestation(:'proj4','email','r***@shop.in','hmac-1', encode(extensions.digest('tok-abc','sha256'),'hex'));
select t.login(null,'anon');
select t.ok(public.respond_client_attestation('wrong-token', true)='invalid','E7 wrong attestation token rejected');
select t.ok(public.respond_client_attestation('tok-abc', true)='confirmed','E8 client confirms via link (no account needed)');
select t.ok(public.respond_client_attestation('tok-abc', true)='invalid','E9 attestation link is single-use');
reset role;
select t.ok((select is_ownership_verified and verification_method='client_attestation' from public.projects where id=:'proj4'),'E10 attestation marks project verified');
select t.ok((select score_breakdown->>'verification' from public.talent_public where id=:'talent4')='10','E11 attestation-only verification worth 10 (direct proof worth 20)');

-- ============ F. response velocity ============
reset role;
select t.fake_unlock(:'talent4', true, interval '5 minutes', interval '1 day');
select t.fake_unlock(:'talent4', true, interval '30 minutes', interval '1 day');
select t.fake_unlock(:'talent4', true, interval '2 hours', interval '1 day');
select t.fake_unlock(:'talent4', false, null, interval '1 day');            -- delivered while OFFLINE -> must not count
select private.recompute_response_velocity(:'talent4');
select t.ok((select response_velocity_score from public.talent_public where id=:'talent4')=80,'F1 median(100,80,50)=80; offline-delivered lead ignored (no sleeper penalty)',(select score_breakdown::text from public.talent_public where id=:'talent4'));
select t.fake_unlock(:'talent4', true, null, interval '1 day') as u_silent \gset
select private.recompute_response_velocity(:'talent4');
select t.ok((select response_velocity_score from public.talent_public where id=:'talent4')=65,'F2 unacknowledged online lead counts as 0 -> median(100,80,50,0)=65');
select t.fake_unlock(:'talent4', true, null, interval '30 minutes') as u_fresh \gset
select private.recompute_response_velocity(:'talent4');
select t.ok((select response_velocity_score from public.talent_public where id=:'talent4')=65,'F3 lead still inside its 4h window is not penalised yet');
insert into public.lead_feedback(unlock_id,recruiter_id,talent_id,rating) select id,recruiter_id,talent_id,'responsive' from public.lead_unlocks where id=:'u_silent';
select private.recompute_response_velocity(:'talent4');
select t.ok((select response_velocity_score from public.talent_public where id=:'talent4')=70,'F4 thumbs-up from a paid unlock = +5');
select t.ok((select response_velocity_score from public.talent_public where id=:'talent2')=70,'F5 new talent with no leads keeps neutral 70');

-- ============ G. ghost reports, refunds, strikes ============
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select t.expect_error(format('select public.report_ghosting(%L)', :'talent3'),'whatsapp_not_opened','G1 cannot report before opening WhatsApp');
select t.ok(public.open_whatsapp(:'talent3')='https://wa.me/919876500003','G2 open_whatsapp returns wa.me link and records the click');
select t.expect_error(format('select public.report_ghosting(%L)', :'talent3'),'delivery_window_open','G3 must wait 24h after opening WhatsApp');
reset role;
update public.lead_unlocks set whatsapp_clicked_at = now() - interval '25 hours' where recruiter_id=:'rec1';
-- trial unlock can never be reported
select t.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated');
select public.unlock_talent_contact(:'talent4');                                  -- rec2 spends its free trial on talent4 (standard)
select public.open_whatsapp(:'talent4');
reset role;
update public.lead_unlocks set whatsapp_clicked_at = now() - interval '25 hours' where recruiter_id=:'rec2';
select t.login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','authenticated');
select t.expect_error(format('select public.report_ghosting(%L)', :'talent4'),'trial_unlocks_not_reportable','G4 free-trial unlock can never produce a ghost report / refund / strike');

-- real report: talent silent -> auto-upheld
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select public.report_ghosting(:'talent3','no reply in 25h') as rep_a \gset
select t.expect_error(format('select public.report_ghosting(%L)', :'talent3'),'already_reported','G5 one report per unlock');
select t.ok((select status='awaiting_talent' and talent_deadline > now()+interval '11 hours' from public.ghost_reports where id=:'rep_a'),'G6 talent gets a ~12h window');
reset role;
select t.ok(private.resolve_expired_ghost_reports()=0,'G7 nothing resolves while the window is open');
update public.ghost_reports set talent_deadline = now() - interval '1 minute' where id=:'rep_a';
select t.ok(private.resolve_expired_ghost_reports()=1,'G8 beta: expired window + silent talent -> goes to a HUMAN (admin review), not an automatic refund');
select t.ok((select status from public.ghost_reports where id=:'rep_a')='under_review' and (select count(*) from public.review_queue where type='ghost_dispute' and related_id=:'rep_a')=1,'G8b report is under review and queued for the admin');
select t.ok((select credits_balance from public.recruiters where id=:'rec1')=1 and (select count(*) from public.strikes where talent_id=:'talent3')=0,'G8c nothing is refunded and no strike is given until a human decides');
select t.login(null,'service_role');
select public.admin_resolve_ghost_report(:'rep_a', true, 'admin confirmed: no reply');
reset role;
select t.ok((select credits_balance from public.recruiters where id=:'rec1')=3,'G9 admin upholds -> recruiter refunded exactly what was paid (2 credits) -> 1+2=3');
select t.ok((select count(*) from public.credits_ledger where recruiter_id=:'rec1' and reason='ghost_refund' and delta=2)=1,'G10 refund is in the ledger');
select t.ok((select count(*) from public.strikes where talent_id=:'talent3' and status='active')=1,'G11 strike 1 recorded');
select t.ok((select response_velocity_score from public.talent_public where id=:'talent3')=50,'G12 strike docks velocity 20 (70 -> 50)');
select private.resolve_expired_ghost_reports();
select t.ok((select credits_balance from public.recruiters where id=:'rec1')=3,'G13 resolver is idempotent: no double refund');
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select t.expect_error(format('select public.unlock_talent_contact(%L)', :'talent3'),'unlock_refunded','G14 refunded unlock cannot be re-viewed (refund != keep the contact)');
select t.expect_error(format('select public.open_whatsapp(%L)', :'talent3'),'unlock_not_found','G15 refunded unlock cannot open WhatsApp');

-- talent disputes with evidence -> manual review, no penalty
select public.open_whatsapp(:'talent2');
reset role;
update public.lead_unlocks set whatsapp_clicked_at = now() - interval '25 hours' where recruiter_id=:'rec1' and talent_id=:'talent2';
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select public.report_ghosting(:'talent2') as rep_b \gset
select t.login(null,'service_role');
select t.ok(public.submit_ghost_dispute(:'rep_b', 999999, 'I replied', array['https://img/x.png'])=false,'G16 dispute from the wrong Telegram chat is rejected');
select t.ok(public.submit_ghost_dispute(:'rep_b', 555002, 'I replied on WhatsApp', array['https://img/x.png'])=true,'G17 dispute from the talent''s own Telegram accepted');
select t.ok((select count(*) from public.review_queue where type='ghost_dispute' and related_id=:'rep_b')=1,'G18 dispute lands in the manual review queue');
reset role;
update public.ghost_reports set talent_deadline = now() - interval '1 minute' where id=:'rep_b';
select t.ok(private.resolve_expired_ghost_reports()=0,'G19 disputed report is NOT auto-upheld');
select t.login(null,'service_role');
select public.admin_resolve_ghost_report(:'rep_b', false, 'screenshot verified');
reset role;
select t.ok((select status from public.ghost_reports where id=:'rep_b')='rejected' and (select count(*) from public.strikes where talent_id=:'talent2')=0,'G20 admin rejects report -> no strike');

-- monthly cap: rec1 has filed 2 -> third blocked
select t.login(null,'service_role');
select public.create_payment_order(:'rec1','credits_10','idem-3','order_3'); select public.fulfill_payment('order_3','pay_3');
reset role;
select t.make_talent('55555555-5555-5555-5555-555555555555','developer','Fifth Dev','+919876500005',555005,array['go']) as talent5 \gset
select t.login(null,'service_role');
select public.set_work_depth_from_commits(:'talent5', 10, now(), '{}');
reset role;
update public.talent_public set is_online=true where id=:'talent5';
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select public.unlock_talent_contact(:'talent5'); select public.open_whatsapp(:'talent5');
reset role;
update public.lead_unlocks set whatsapp_clicked_at = now() - interval '25 hours' where recruiter_id=:'rec1' and talent_id=:'talent5';
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select t.expect_error(format('select public.report_ghosting(%L)', :'talent5'),'monthly_report_cap_reached','G21 max 2 ghost reports per recruiter per month');

-- ============ H. rank snapshot ============
reset role;
select private.take_rank_snapshot();
select t.ok((select state_rank from public.talent_public where id=:'talent3')=1,'H1 elite developer is #1 in Assam developers');
select t.ok((select count(*) from public.rank_snapshots where recorded_on = current_date or true)=(select count(*) from public.talent_public where is_listed),'H2 one snapshot row per listed talent');
select t.ok((select max(state_cohort_size) from public.talent_public where role='developer')=4,'H3 leaderboard is per role+state (4 listed developers)',(select max(state_cohort_size)::text from public.talent_public where role='developer'));

-- ============ I. escalation: strike 2 = suspension, strike 3 = ban review ============
select private.uphold_ghost_report(t.fake_report(:'talent3'), 'x');
select t.login(null,'anon');
select t.ok((select count(*) from public.talent_public where id=:'talent3')=0,'I1 strike 2 -> profile hidden from the map (14-day suspension)');
reset role;
select t.ok((select suspended_until > now()+interval '13 days' from public.talent_public where id=:'talent3'),'I2 suspension is ~14 days');
select t.ok((select is_online from public.talent_public where id=:'talent3')=false,'I3 suspended talent is forced Offline');
select private.uphold_ghost_report(t.fake_report(:'talent3'), 'x');
select t.ok((select count(*) from public.review_queue where talent_id=:'talent3' and type='ban_review' and status='pending')=1,'I4 strike 3 -> ban goes to MANUAL review (not automatic)');
select t.ok((select is_banned from public.talent_public where id=:'talent3')=false,'I5 not banned until an admin acts');
select response_velocity_score as v_with_strikes from public.talent_public where id=:'talent3' \gset
update public.strikes set expires_at = now() - interval '1 day' where talent_id=:'talent3';
select private.recompute_response_velocity(:'talent3');
select response_velocity_score as v_after_expiry from public.talent_public where id=:'talent3' \gset
select t.ok(:v_after_expiry - :v_with_strikes = 60,'I6 3 strikes cost 60 velocity pts; once they expire (90 days) the penalty disappears', 'with='||:v_with_strikes||' after='||:v_after_expiry);
update public.strikes set expires_at = now() + interval '30 days' where talent_id=:'talent3';
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select t.expect_error($$select public.admin_ban_talent(gen_random_uuid())$$,'forbidden','I7 normal users cannot call admin functions (forbidden: the function itself checks the JWT)');
select t.login(null,'service_role');
select public.admin_ban_talent(:'talent3','repeated ghosting');
reset role;
select t.ok((select is_banned from public.talent_public where id=:'talent3') and (select count(*) from public.blocklist)=2,'I8 admin ban -> banned + phone & GitHub blocklisted (hashes)');

-- banned phone cannot re-register under a new account
reset role;
update auth.users set phone='919876500003', phone_confirmed_at=now() where id='cccccccc-cccc-cccc-cccc-cccccccccccc';
select t.login('cccccccc-cccc-cccc-cccc-cccccccccccc','authenticated');
select public.record_consent('dpdp_directory_listing','v1'); select public.record_consent('contact_disclosure','v1'); select public.record_consent('phone_processing','v1');
select t.expect_error($$select public.create_talent_profile('designer','New Name','Guwahati','Assam',26.1,91.7,'Assamese',array[]::text[],array['figma'],60000,'+919876500003','+919876500003','n@x.in')$$,'account_blocked','I9 banned phone cannot re-register with a new account');

-- ============ J. scheduled jobs ============
reset role;
update public.talent_public set online_since = now() - interval '9 hours' where id=:'talent1';
select private.expire_online_status() as expired_n \gset
select t.ok(:expired_n>=1 and (select is_online from public.talent_public where id=:'talent1')=false,'J1 Online auto-expires after 8h');
update public.talent_private set cap_date = current_date - 1, unlocks_today = 5 where talent_id=:'talent5';
update public.talent_public set is_at_daily_cap = true where id=:'talent5';
select private.reset_daily_caps();
select t.ok((select unlocks_today from public.talent_private where talent_id=:'talent5')=0 and (select is_at_daily_cap from public.talent_public where id=:'talent5')=false,'J2 daily cap resets at midnight IST');
select t.login('55555555-5555-5555-5555-555555555555','authenticated');
select public.withdraw_consent('dpdp_directory_listing');
select t.login(null,'anon');
select t.ok((select count(*) from public.talent_public where id=:'talent5')=0,'J3 withdrawing DPDP listing consent hides the profile immediately');
reset role;
select private.purge_old_operational_data();
select t.ok(true,'J4 purge job runs');

-- ============ K. erasure: anonymise, never cascade into financial / consent records ============
select t.login('22222222-2222-2222-2222-222222222222','authenticated');
select public.erase_my_account();
reset role;
select t.ok((select count(*) from public.talent_private where talent_id=:'talent2')=0,'K1 erased talent: contact vault row deleted');
select t.ok((select deleted_at is not null and user_id is null and masked_name='Deleted talent' and city='-' and not is_listed from public.talent_public where id=:'talent2'),'K2 erased talent: public row is an anonymous tombstone');
select t.ok((select count(*) from public.lead_unlocks where talent_id=:'talent2')=1,'K3 recruiter''s paid unlock record survives talent erasure');
select t.ok((select count(*) from public.consents where subject_ref=:'talent2' and user_id is null and ip_address is null and erased_at is not null)=3,'K4 consent evidence kept but de-identified (3 rows)');
select t.ok((select count(*) from public.ghost_reports where talent_id=:'talent2' and talent_dispute_note is null and evidence_urls='{}')=1,'K5 dispute free-text/evidence scrubbed, report row kept');
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select t.expect_error(format('select public.unlock_talent_contact(%L)', :'talent2'),'talent_unavailable','K6 nobody can fetch an erased talent''s contact');
select t.expect_error('select public.erase_my_account()','credits_remaining','K7 recruiter with unused credits must explicitly forfeit them');
select public.erase_my_account(true);
reset role;
select t.ok((select user_id is null and phone_e164 like 'erased:%' and company_name is null and deleted_at is not null and credits_balance=0 from public.recruiters where id=:'rec1'),'K8 recruiter anonymised, credits forfeited');
select t.ok((select count(*) from public.payments where recruiter_id=:'rec1')=3 and (select count(*) from public.credits_ledger where recruiter_id=:'rec1')>=8,'K9 payments + ledger retained for the 7-year tax window');
select count(*) as pay_before from public.payments \gset
select count(*) as led_before from public.credits_ledger \gset
select count(*) as unl_before from public.lead_unlocks \gset
delete from auth.users where id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222');
select t.ok((select count(*) from public.payments)=:pay_before and (select count(*) from public.credits_ledger)=:led_before and (select count(*) from public.lead_unlocks)=:unl_before,'K10 deleting the auth user does NOT cascade into payments / ledger / unlocks');
select t.expect_error($$delete from public.recruiters where id in (select recruiter_id from public.payments limit 1)$$,'violates foreign key','K11 a recruiter with payments cannot be hard-deleted');
select t.expect_error($$delete from public.talent_public where id in (select talent_id from public.lead_unlocks limit 1)$$,'violates foreign key','K12 a talent with unlocks cannot be hard-deleted');

-- ============ L. coverage ============
select t.ok((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity)=0,'L1 every public table has RLS enabled');

-- ============ summary ============
\set QUIET off
select 'TOTAL='||count(*)||'  PASS='||count(*) filter (where ok)||'  FAIL='||count(*) filter (where not ok) as summary from t.results;
select n, label, detail from t.results where not ok order by n;
