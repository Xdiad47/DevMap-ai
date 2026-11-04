\set ON_ERROR_STOP off
\pset pager off
\set QUIET on
-- Sprint 4: admin actions, review queues, audit trail, client attestation. DB with stub + ALL migrations + seed.sql.
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
-- a signed-in user whose JWT carries app_metadata.role = 'admin' (what Supabase Auth issues after we set it)
create function t.login_admin(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'app_metadata', jsonb_build_object('role','admin'))::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create function t.expect_error(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql; perform t.ok(false, p_label, 'NO ERROR RAISED');
  exception when others then perform t.ok(sqlerrm ilike '%'||p_pattern||'%', p_label, case when sqlerrm ilike '%'||p_pattern||'%' then null else 'got: '||sqlerrm end);
  end;
end $$;
create function t.fake_unlock(p_talent uuid, p_credits int default 1) returns uuid language plpgsql as $$
declare r uuid; u uuid;
begin
  insert into public.recruiters(phone_e164, is_phone_verified) values ('+91'||(floor(random()*9e9)+1e9)::bigint::text, true) returning id into r;
  insert into public.lead_unlocks(recruiter_id, talent_id, tier_at_unlock, credits_deducted, is_trial, talent_online_at_unlock,
        has_clicked_whatsapp, whatsapp_clicked_at)
  values (r, p_talent, 'standard', p_credits, false, true, true, now() - interval '30 hours') returning id into u;
  return u;
end $$;
create function t.fake_report(p_talent uuid, p_disputed boolean) returns uuid language plpgsql as $$
declare u uuid; rid uuid; rep uuid;
begin
  u := t.fake_unlock(p_talent, 2);
  select recruiter_id into rid from public.lead_unlocks where id = u;
  insert into public.ghost_reports(unlock_id, recruiter_id, talent_id, talent_deadline, recruiter_note)
  values (u, rid, p_talent, now() + interval '10 hours', 'no reply') returning id into rep;
  if p_disputed then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform public.submit_ghost_dispute(rep, (select telegram_chat_id from public.talent_private where talent_id = p_talent), 'I replied', array['telegram:photo:ABC']);
  end if;
  return rep;
end $$;

\set admin 'ad000000-0000-4000-8000-000000000001'
\set normal 'ee000000-0000-4000-8000-000000000002'
\set t1 '00000000-0000-4000-8000-000000000001'
\set t2 '00000000-0000-4000-8000-000000000002'
\set t3 '00000000-0000-4000-8000-000000000003'
\set t4 '00000000-0000-4000-8000-000000000004'
\set t5 '00000000-0000-4000-8000-000000000005'
\set t6 '00000000-0000-4000-8000-000000000006'
\set t7 '00000000-0000-4000-8000-000000000007'
insert into auth.users(id,email) values (:'admin','admin@x.in'), (:'normal','normal@x.in');

-- ===================== A. who may call admin functions =====================
select t.login(null,'anon');
select t.expect_error($$select public.admin_ban_talent(gen_random_uuid())$$,'permission denied','A1 anon cannot even call admin functions');
select t.login(:'normal','authenticated');
select t.expect_error($$select public.admin_ban_talent(gen_random_uuid())$$,'forbidden','A2 a normal signed-in user is refused (forbidden)');
select t.expect_error($$select public.admin_set_talent_review(gen_random_uuid(),'reviewed',10)$$,'forbidden','A3 ...also for reviews');
select t.expect_error($$select public.admin_resolve_ghost_report(gen_random_uuid(),true)$$,'forbidden','A4 ...ghost resolution');
select t.expect_error($$select public.admin_restore_talent(gen_random_uuid())$$,'forbidden','A5 ...restore');
select t.expect_error($$select public.admin_dismiss_ban_review(gen_random_uuid())$$,'forbidden','A6 ...dismissing a ban review');
select t.expect_error($$select public.admin_review_attestation(gen_random_uuid(),true)$$,'forbidden','A7 ...attestation review');
select t.expect_error($$select * from public.admin_audit_log$$,'permission denied','A8 nobody but the service role reads the audit log');
select t.login(:'normal','authenticated');
select set_config('request.jwt.claims', jsonb_build_object('sub',:'normal','role','authenticated','app_metadata',jsonb_build_object('role','user'))::text, false);
select t.expect_error($$select public.admin_ban_talent(gen_random_uuid())$$,'forbidden','A9 app_metadata.role other than admin is refused');
-- user_metadata is user-editable in Supabase: it must NOT grant admin
select set_config('request.jwt.claims', jsonb_build_object('sub',:'normal','role','authenticated','user_metadata',jsonb_build_object('role','admin'))::text, false);
select t.expect_error($$select public.admin_ban_talent(gen_random_uuid())$$,'forbidden','A10 user_metadata.role = admin (self-editable) does NOT grant admin');
reset role;

-- ===================== B. portfolio queue =====================
-- a new designer and a new marketer arrive; a developer does not enter this queue
insert into public.talent_public(id, role, masked_name, city, state, latitude, longitude, native_language, skills, hourly_rate_paise)
values ('dd000000-0000-4000-8000-000000000001','designer','Nina P.','Guwahati','Assam',26.14,91.73,'Assamese','{figma}',50000),
       ('dd000000-0000-4000-8000-000000000002','marketer','Omar K.','Silchar','Assam',24.83,92.77,'Bengali','{seo}',40000),
       ('dd000000-0000-4000-8000-000000000003','developer','Dev Q.','Guwahati','Assam',26.14,91.73,'Assamese','{react}',50000);
insert into public.talent_private(talent_id, full_name, phone_e164, whatsapp_number, email, portfolio_links, is_phone_verified, daily_unlock_cap, telegram_chat_id)
values ('dd000000-0000-4000-8000-000000000001','Nina Paul','+919500000001','+919500000001','nina@x.in','["https://behance.net/nina"]',true,5,-5001),
       ('dd000000-0000-4000-8000-000000000002','Omar Khan','+919500000002','+919500000002','omar@x.in','["https://omar.example/work"]',true,5,-5002),
       ('dd000000-0000-4000-8000-000000000003','Dev Qadir','+919500000003','+919500000003','devq@x.in','[]',true,5,-5003);
select t.ok((select count(*) from public.review_queue where talent_id='dd000000-0000-4000-8000-000000000001' and type='designer_portfolio' and status='pending')=1,'B1 a new designer enters the designer_portfolio queue');
select t.ok((select count(*) from public.review_queue where talent_id='dd000000-0000-4000-8000-000000000002' and type='marketer_portfolio' and status='pending')=1,'B2 a new marketer enters the marketer_portfolio queue');
select t.ok((select count(*) from public.review_queue where talent_id='dd000000-0000-4000-8000-000000000003')=0,'B3 developers are scored from GitHub, not queued for manual review');
select t.ok((select count(*) from public.review_queue where talent_id::text like '00000000-0000-4000-8000-%' and type in ('designer_portfolio','marketer_portfolio'))=0,'B4 pre-reviewed seed designers/marketers are not queued');
select t.ok((select is_listed from public.talent_public where id='dd000000-0000-4000-8000-000000000001')=false,'B5 an unreviewed designer is NOT listed (proof 0)');

select id as q_nina from public.review_queue where talent_id='dd000000-0000-4000-8000-000000000001' \gset
select t.login_admin(:'admin');
select t.expect_error(format('select public.admin_set_talent_review(%L,%L,41)','dd000000-0000-4000-8000-000000000001','reviewed'),'work_depth_out_of_range','B6 work depth above 40 is refused');
select t.expect_error(format('select public.admin_set_talent_review(%L,%L,10)',gen_random_uuid(),'reviewed'),'talent_not_found','B7 unknown talent is an error, not a silent no-op');
select public.admin_set_talent_review('dd000000-0000-4000-8000-000000000001','reviewed',24,'strong case studies',:'q_nina');
reset role;
select t.ok((select review_status='reviewed' and proof_score=34 and is_listed from public.talent_public where id='dd000000-0000-4000-8000-000000000001'),'B8 rubric 24 + reviewed(10) -> proof 34 and the designer becomes listed', (select proof_score::text from public.talent_public where id='dd000000-0000-4000-8000-000000000001'));
select t.ok((select status='approved' and reviewer_id=:'admin'::uuid and reviewer_notes='strong case studies' and resolved_at is not null from public.review_queue where id=:'q_nina'),'B9 queue item approved, with the REAL admin as reviewer');
select t.ok((select count(*)=1 from public.admin_audit_log where action='set_review:reviewed:24' and target_id='dd000000-0000-4000-8000-000000000001' and admin_id=:'admin'::uuid),'B10 the action is in the audit log under the admin''s id');
select id as q_omar from public.review_queue where talent_id='dd000000-0000-4000-8000-000000000002' \gset
select t.login_admin(:'admin');
select public.admin_set_talent_review('dd000000-0000-4000-8000-000000000002','unverified',0,'links are stock photos',:'q_omar');
reset role;
select t.ok((select status='rejected' from public.review_queue where id=:'q_omar') and (select is_listed=false from public.talent_public where id='dd000000-0000-4000-8000-000000000002'),'B11 rejecting leaves them unreviewed/unlisted and closes the item as rejected');

-- ===================== C. ghost dispute queue =====================
select t.fake_report(:'t2', true) as rep1 \gset
select t.fake_report(:'t3', true) as rep2 \gset
select id as q1 from public.review_queue where related_id=:'rep1' and type='ghost_dispute' \gset
select id as q2 from public.review_queue where related_id=:'rep2' and type='ghost_dispute' \gset
select t.ok((select count(*)=2 from public.review_queue where type='ghost_dispute' and status='pending'),'C1 two disputed reports are waiting');
select recruiter_id as rec1 from public.ghost_reports where id=:'rep1' \gset
select t.login_admin(:'admin');
select t.expect_error(format('select public.admin_resolve_ghost_report(%L,true)',gen_random_uuid()),'report_not_found','C2 unknown report -> error');
select public.admin_resolve_ghost_report(:'rep1', true, 'screenshot shows no reply', :'q1');
select public.admin_resolve_ghost_report(:'rep2', false, 'screenshot proves a reply', :'q2');
reset role;
select t.ok((select status='upheld' from public.ghost_reports where id=:'rep1') and (select count(*)=1 from public.strikes where report_id=:'rep1' and status='active'),'C3 upheld -> report upheld + a strike');
select t.ok((select credits_balance=2 from public.recruiters where id=:'rec1'),'C4 upheld -> the recruiter got exactly what they paid back (2)');
select t.ok((select status='rejected' from public.ghost_reports where id=:'rep2') and (select count(*)=0 from public.strikes where report_id=:'rep2'),'C5 rejected -> no strike');
select t.ok((select status='approved' from public.review_queue where id=:'q1') and (select status='rejected' from public.review_queue where id=:'q2'),'C6 queue items mirror the decisions');
select t.ok((select count(*)=2 from public.admin_audit_log where target_type='ghost_report' and admin_id=:'admin'::uuid),'C7 both decisions audited');
select t.ok((select (payload->>'talent_id')::uuid=:'t2'::uuid from public.telegram_outbox where kind='strike_notice' and talent_id=:'t2'),'C8 the strike notice payload carries the talent id (for the appeal e-mail subject)');

-- ===================== D. strike 3 -> ban review =====================
select t.fake_report(:'t4', false) as ra \gset
select t.fake_report(:'t4', false) as rb \gset
select t.fake_report(:'t4', false) as rc \gset
select private.apply_strike(:'t4', :'ra'); select private.apply_strike(:'t4', :'rb'); select private.apply_strike(:'t4', :'rc');
select t.ok((select count(*)=1 from public.review_queue where talent_id=:'t4' and type='ban_review' and status='pending'),'D1 the third strike opens exactly one ban_review');
select id as qb from public.review_queue where talent_id=:'t4' and type='ban_review' \gset
select t.ok((select suspended_until > now() from public.talent_public where id=:'t4'),'D2 meanwhile the talent is suspended (not banned)');
select t.login_admin(:'admin');
select public.admin_dismiss_ban_review(:'qb','first offence in a year; keep suspension');
select t.expect_error(format('select public.admin_dismiss_ban_review(%L)',:'qb'),'review_item_not_open','D3 an item can be closed only once');
reset role;
select t.ok((select status='rejected' from public.review_queue where id=:'qb') and (select is_banned=false from public.talent_public where id=:'t4'),'D4 dismissing = no ban; suspension just runs its course');
-- ban path
select t.fake_report(:'t5', false) as rd \gset
select private.apply_strike(:'t5', :'rd');
insert into public.review_queue(talent_id, type, related_id) values (:'t5','ban_review',:'rd') returning id as qban \gset
select t.login_admin(:'admin');
select public.admin_ban_talent(:'t5','fabricated projects',:'qban');
reset role;
select t.ok((select is_banned and not is_online from public.talent_public where id=:'t5'),'D5 ban executes');
select t.ok((select count(*)=2 from public.blocklist where reason='fabricated projects'),'D6 phone + GitHub are blocklisted as hashes');
select t.ok((select status='approved' from public.review_queue where id=:'qban'),'D7 the ban item is approved');
select t.login_admin(:'admin');
select public.admin_restore_talent(:'t5','appeal accepted');
reset role;
select t.ok((select not is_banned and suspended_until is null from public.talent_public where id=:'t5'),'D8 restore lifts the ban');
select t.ok((select count(*)=0 from public.strikes where talent_id=:'t5' and status='active'),'D9 ...and overturns active strikes');
insert into public.review_queue(talent_id, type) values (:'t6','ban_review') returning id as qb6 \gset
select t.login_admin(:'admin'); select public.admin_restore_talent(:'t6','cleared'); reset role;
select t.ok((select status='rejected' from public.review_queue where id=:'qb6'),'D10 restoring someone answers their open ban review');
select t.ok((select count(*)>=3 from public.admin_audit_log where action in ('ban','restore','dismiss_ban_review')),'D11 ban / restore / dismiss are audited');

-- ===================== E. client attestation =====================
insert into public.projects(id, talent_id, generic_title, live_url) values
  ('aa000000-0000-4000-8000-000000000001', :'t7', 'Client shop', 'https://client-one.example.test'),
  ('aa000000-0000-4000-8000-000000000002', :'t7', 'Client blog', 'https://client-two.example.test'),
  ('aa000000-0000-4000-8000-000000000003', :'t7', 'Client app',  'https://client-three.example.test'),
  ('aa000000-0000-4000-8000-000000000004', :'t7', 'Client site', 'https://client-four.example.test');
create function t.att(p_proj uuid, p_hmac text, p_tok text, p_channel text default 'email') returns uuid language plpgsql as $$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v := public.create_client_attestation(p_proj, p_channel, 'r***@client.in', p_hmac, encode(extensions.digest(p_tok,'sha256'),'hex'));
  return v;
end $$;
select t.login(null,'service_role');
select t.att('aa000000-0000-4000-8000-000000000001','hmac-A','tokA1') as a1 \gset
select t.att('aa000000-0000-4000-8000-000000000002','hmac-A','tokA2') as a2 \gset
select t.att('aa000000-0000-4000-8000-000000000003','hmac-A','tokA3') as a3 \gset
select t.expect_error($$select t.att('aa000000-0000-4000-8000-000000000004','hmac-A','tokA4')$$,'contact_rate_limited','E1 a contact is asked at most 3 times a day');
reset role;

-- the client's page
select t.login(null,'anon');
select t.ok((select public.attestation_preview('tokA1')->>'title')='Client shop','E2 anon (the client, no account) can preview with the token');
select t.ok((public.attestation_preview('tokA1') ? 'talent_name') and not (public.attestation_preview('tokA1')::text ilike '%client.in%' or public.attestation_preview('tokA1')::text ilike '%hmac%'),'E3 the preview shows the masked talent name, never contact data or hashes');
select t.ok(public.attestation_preview('wrong') is null and public.attestation_preview('') is null and public.attestation_preview(null) is null,'E4 wrong / empty tokens preview nothing');
select t.expect_error($$select * from public.client_attestations$$,'permission denied','E5 anon cannot read the attestations table');
-- confirm: first two work, third hits the per-contact limit
select t.ok(public.respond_client_attestation('tokA1', true)='confirmed','E6 client confirms #1');
select t.ok(public.respond_client_attestation('tokA2', true)='confirmed','E7 client confirms #2');
select t.ok(public.respond_client_attestation('tokA3', true)='limit_reached','E8 the third confirmation by the same contact in 30 days is refused AT CONFIRMATION TIME');
select t.ok(public.attestation_preview('tokA1') is null,'E9 a used link previews nothing (single use)');
reset role;
select t.ok((select verification_method='client_attestation' and is_ownership_verified from public.projects where id='aa000000-0000-4000-8000-000000000001'),'E10 confirmed -> project verified by attestation');
select t.ok(not (select is_ownership_verified from public.projects where id='aa000000-0000-4000-8000-000000000003') and (select status='declined' from public.client_attestations where id=:'a3'),'E11 the refused one stays unverified and is closed');
select t.ok((select score_breakdown->>'verification' from public.talent_public where id=:'t7')::int >= 10,'E12 attested proof earns verification points (10; reviewer tier may add more)');

-- spot checks
select t.ok((select count(*) from public.review_queue where type='attestation_spotcheck' and related_id in (:'a1',:'a2'))<=2,'E13 email-channel confirmations are spot-checked only sometimes (10%)');
select t.login(null,'service_role');
select t.att('aa000000-0000-4000-8000-000000000004','hmac-W','tokW1','whatsapp') as aw \gset
reset role;
select t.login(null,'anon'); select public.respond_client_attestation('tokW1', true); reset role;
select t.ok((select count(*)=1 from public.review_queue where type='attestation_spotcheck' and related_id=:'aw'),'E14 a WHATSAPP-channel confirmation is ALWAYS spot-checked (the talent carried the link)');
-- force a spot-check on a1 and reject it
delete from public.review_queue where related_id=:'a1' and type='attestation_spotcheck';
insert into public.review_queue(talent_id,type,related_id) values (:'t7','attestation_spotcheck',:'a1') returning id as qa1 \gset
select t.login_admin(:'admin');
select public.admin_review_attestation(:'a1', false, 'client says they never worked with this person', :'qa1');
reset role;
select t.ok(not (select is_ownership_verified from public.projects where id='aa000000-0000-4000-8000-000000000001') and (select verification_method='none' from public.projects where id='aa000000-0000-4000-8000-000000000001'),'E15 rejecting a spot-check removes the project''s attested verification');
select t.ok((select status='declined' from public.client_attestations where id=:'a1') and (select status='rejected' from public.review_queue where id=:'qa1'),'E16 attestation declined, queue item rejected');
-- direct proof is never touched
update public.projects set is_ownership_verified=true, verification_method='well_known_file', verified_at=now() where id='aa000000-0000-4000-8000-000000000002';
select t.login_admin(:'admin'); select public.admin_review_attestation(:'a2', false, 'x'); reset role;
select t.ok((select is_ownership_verified and verification_method='well_known_file' from public.projects where id='aa000000-0000-4000-8000-000000000002'),'E17 rejecting an attestation never strips DIRECT proof');
select id as qaw from public.review_queue where related_id=:'aw' \gset
select t.login_admin(:'admin'); select public.admin_review_attestation(:'aw', true, 'checked with client', :'qaw'); reset role;
select t.ok((select is_ownership_verified from public.projects where id='aa000000-0000-4000-8000-000000000004') and (select status='approved' from public.review_queue where related_id=:'aw'),'E18 approving keeps the verification and closes the item');

-- per-talent daily cap
select t.login(null,'service_role');
select t.att('aa000000-0000-4000-8000-000000000003','hmac-X1','tX1') as dummy1 \gset
reset role;
select t.ok((select count(*) from public.client_attestations a join public.projects p on p.id=a.project_id where p.talent_id=:'t7' and a.created_at>now()-interval '24 hours')>=5,'E19 (setup) the talent has now sent 5 requests today (3 + 1 WhatsApp + 1)');
select t.login(null,'service_role');
select t.expect_error($$select t.att('aa000000-0000-4000-8000-000000000003','hmac-X3','tX3')$$,'talent_rate_limited','E20 one talent sends at most 5 requests a day (we send mail from our domain)');
select t.expect_error($$select t.att(gen_random_uuid(),'hmac-Y','tY')$$,'project_not_found','E21 unknown project');
reset role;
select t.login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','authenticated');
select t.expect_error($$select public.create_client_attestation(gen_random_uuid(),'email','x','y','z')$$,'permission denied','E22 users cannot create attestations themselves (the server does, after its own checks)');
reset role;

-- ===== summary =====
\set QUIET off
select 'TOTAL='||count(*)||'  PASS='||count(*) filter (where ok)||'  FAIL='||count(*) filter (where not ok) as summary from t.results;
select n, label, detail from t.results where not ok order by n;
