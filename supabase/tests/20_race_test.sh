#!/bin/bash
SP=$(mktemp -d)
q() { docker exec -i "${NAME:-devmap-test-pg}" psql -U postgres -d devmap_test -At -q "$@"; }

q <<'EOF' >/dev/null 2>&1
insert into auth.users(id,email) values
 ('c0000007-0000-0000-0000-000000000007','recC@x.in'),('c0000008-0000-0000-0000-000000000008','recD@x.in'),
 ('d0000001-0000-0000-0000-000000000001','tx@x.in'),('d0000002-0000-0000-0000-000000000002','ty@x.in'),('d0000003-0000-0000-0000-000000000003','tz@x.in');
select t.make_talent('d0000001-0000-0000-0000-000000000001','designer','Xena Roy','+919811100001',770001,array['figma']);
select t.make_talent('d0000002-0000-0000-0000-000000000002','designer','Yash Roy','+919811100002',770002,array['figma']);
select t.make_talent('d0000003-0000-0000-0000-000000000003','designer','Zara Roy','+919811100003',770003,array['figma']);
update public.talent_public set proof_score=100, review_status='verified', is_online=true where masked_name in ('Xena R.','Yash R.','Zara R.');
select t.make_recruiter('c0000007-0000-0000-0000-000000000007','+919822200007');
select t.make_recruiter('c0000008-0000-0000-0000-000000000008','+919822200008');
update public.recruiters set trial_unlocks_remaining=0 where phone_e164 in ('+919822200007','+919822200008');
select private.apply_credit_delta(id, 2, 'admin_adjustment', gen_random_uuid()) from public.recruiters where phone_e164='+919822200007';
select private.apply_credit_delta(id, 5, 'admin_adjustment', gen_random_uuid()) from public.recruiters where phone_e164='+919822200008';
EOF
X=$(q -c "select id from public.talent_public where masked_name='Xena R.'")
Y=$(q -c "select id from public.talent_public where masked_name='Yash R.'")
Z=$(q -c "select id from public.talent_public where masked_name='Zara R.'")
echo "setup: X=$X"; echo "       C balance: $(q -c "select credits_balance from public.recruiters where phone_e164='+919822200007'")  D balance: $(q -c "select credits_balance from public.recruiters where phone_e164='+919822200008'")"

echo; echo "== RACE 1: recruiter C has exactly 2 credits. Session A unlocks elite X (2 credits) and holds its transaction open 3s."
echo "            Session B tries to unlock a DIFFERENT elite Y (2 credits) 1s later."
( q > $SP/raceA.txt 2>&1 <<EOF
select set_config('request.jwt.claims','{"sub":"c0000007-0000-0000-0000-000000000007","role":"authenticated"}',false) is not null;
select set_config('role','authenticated',false) is not null;
begin;
select 'A: unlock X -> '||(public.unlock_talent_contact('$X') is not null)||' @'||to_char(clock_timestamp(),'SS.MS');
select pg_sleep(3);
commit;
select 'A: committed @'||to_char(clock_timestamp(),'SS.MS');
EOF
) &
sleep 1
( q > $SP/raceB.txt 2>&1 <<EOF
select set_config('request.jwt.claims','{"sub":"c0000007-0000-0000-0000-000000000007","role":"authenticated"}',false) is not null;
select set_config('role','authenticated',false) is not null;
select 'B: started  @'||to_char(clock_timestamp(),'SS.MS');
select public.unlock_talent_contact('$Y');
EOF
echo "B: ended    @$(date +%S).$(date +%3N 2>/dev/null)" >> $SP/raceB.txt
) &
wait
grep -hE "^A:|^B:|ERROR" $SP/raceA.txt $SP/raceB.txt
q -c "select 'RESULT  C balance='||r.credits_balance||'  (must be 0, never negative)  unlock rows='||(select count(*) from public.lead_unlocks where recruiter_id=r.id)||' (must be 1)' from public.recruiters r where phone_e164='+919822200007'"

echo; echo "== RACE 2: recruiter D (5 credits) fires 6 SIMULTANEOUS unlocks of the SAME elite profile Z (2 credits)"
for i in 1 2 3 4 5 6; do
 ( q > $SP/race2_$i.txt 2>&1 <<EOF
select set_config('request.jwt.claims','{"sub":"c0000008-0000-0000-0000-000000000008","role":"authenticated"}',false) is not null;
select set_config('role','authenticated',false) is not null;
select 'ok:'||(public.unlock_talent_contact('$Z') is not null);
EOF
 ) &
done
wait
echo "6 responses:"; cat $SP/race2_*.txt | grep -E "ok:|ERROR" | sort | uniq -c
q -c "select 'RESULT  D balance='||r.credits_balance||' (expect 3)  unlock rows='||(select count(*) from public.lead_unlocks where recruiter_id=r.id)||' (expect 1)  unlock_top ledger rows='||(select count(*) from public.credits_ledger where recruiter_id=r.id and reason='unlock_top')||' (expect 1)' from public.recruiters r where phone_e164='+919822200008'"

echo; echo "== RACE 3: 20 queued Telegram messages, 6 workers claim (5 each) at the same instant: no message may be handed to two workers"
q -c "insert into public.telegram_outbox(talent_id, kind, dedupe_key) select '$X', 'lead_alert', 'race3:'||g from generate_series(1,20) g"
for i in 1 2 3 4 5 6; do
 ( q > $SP/race3_$i.txt 2>&1 <<EOF2
select set_config('request.jwt.claims','{"role":"service_role"}',false) is not null;
select set_config('role','service_role',false) is not null;
select 'claimed:'||id from public.claim_telegram_outbox(5);
EOF2
 ) &
done
wait
TOTAL=$(cat $SP/race3_*.txt | grep -c "^claimed:"); UNIQ=$(cat $SP/race3_*.txt | grep "^claimed:" | sort -u | wc -l | tr -d ' ')
# earlier suites in this DB also left queued rows, so the total can exceed my 20; the property is "no duplicates"
if [ "$TOTAL" = "$UNIQ" ] && [ "$TOTAL" -ge 20 ]; then echo "RESULT  race3 OK claimed=$TOTAL distinct=$UNIQ (no row handed out twice)"; else echo "RESULT  race3 BAD claimed=$TOTAL distinct=$UNIQ"; fi
