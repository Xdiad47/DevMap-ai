#!/bin/bash
# Runs the migration + all tests on a throwaway Postgres container (PG_IMAGE=postgres:15 to change; default 17) (needs Docker running).
#   supabase/tests/run_tests.sh          -> fresh container, removed afterwards
#   KEEP=1 supabase/tests/run_tests.sh   -> keep the container for poking around
# NOTE: Supabase Auth/roles are imitated by 00_supabase_stub.sql. Re-run the SQL on a real
#       `supabase start` stack before production (see PRD §16).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
MIGS=("$HERE"/../migrations/*.sql)
SEED="$HERE/../seed.sql"
export NAME=devmap-test-pg
docker rm -f $NAME >/dev/null 2>&1 || true
docker run -d --name $NAME -e POSTGRES_PASSWORD=pw "${PG_IMAGE:-postgres:17}" >/dev/null
trap '[ -z "$KEEP" ] && docker rm -f $NAME >/dev/null 2>&1' EXIT
until docker exec $NAME pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done; sleep 4
P="docker exec -i $NAME psql -U postgres"
$P -q -c "create database devmap_test"
$P -d devmap_test -v ON_ERROR_STOP=1 -q < "$HERE/00_supabase_stub.sql"
apply() { for f in "${MIGS[@]}"; do $P -d "$1" -v ON_ERROR_STOP=1 -1 -q < "$f" 2>&1 | grep -v "already exists, skipping" || true; done; }
echo "== applying ${#MIGS[@]} migrations"; apply devmap_test && echo "migrations OK"
echo "== behaviour tests"
OUT=$($P -d devmap_test < "$HERE/10_behavior_tests.sql" 2>&1)
echo "$OUT" | grep -E "^NOTICE:  FAIL|TOTAL|^ERROR" || true
echo "$OUT" | grep -q "FAIL=0" || { echo "BEHAVIOUR TESTS FAILED"; exit 1; }
echo "== discovery tests (all migrations + seed)"
$P -q -c "create database devmap_seed"
$P -d devmap_seed -v ON_ERROR_STOP=1 -q < "$HERE/00_supabase_stub.sql"
apply devmap_seed
$P -d devmap_seed -v ON_ERROR_STOP=1 -q < "$SEED" 2>&1 | grep -E "seed:|ERROR" || true
OUT2=$($P -d devmap_seed < "$HERE/11_discovery_tests.sql" 2>&1)
echo "$OUT2" | grep -E "^NOTICE:  FAIL|TOTAL|^ERROR" || true
echo "$OUT2" | grep -q "FAIL=0" || { echo "DISCOVERY TESTS FAILED"; exit 1; }
echo "== sprint 3 tests (outbox, queues): own database, because the discovery suite leaves talents paused/banned"
$P -q -c "create database devmap_s3"
$P -d devmap_s3 -v ON_ERROR_STOP=1 -q < "$HERE/00_supabase_stub.sql"
apply devmap_s3
$P -d devmap_s3 -v ON_ERROR_STOP=1 -q < "$SEED" 2>&1 | grep -E "seed:|ERROR" || true
OUT3=$($P -d devmap_s3 < "$HERE/12_sprint3_tests.sql" 2>&1)
echo "$OUT3" | grep -E "^NOTICE:  FAIL|TOTAL|^ERROR" || true
echo "$OUT3" | grep -q "FAIL=0" || { echo "SPRINT 3 TESTS FAILED"; exit 1; }
echo "== sprint 4 tests (admin actions, queues, attestation): own database"
$P -q -c "create database devmap_s4"
$P -d devmap_s4 -v ON_ERROR_STOP=1 -q < "$HERE/00_supabase_stub.sql"
apply devmap_s4
$P -d devmap_s4 -v ON_ERROR_STOP=1 -q < "$SEED" 2>&1 | grep -E "seed:|ERROR" || true
OUT4=$($P -d devmap_s4 < "$HERE/13_sprint4_tests.sql" 2>&1)
echo "$OUT4" | grep -E "^NOTICE:  FAIL|TOTAL|^ERROR" || true
echo "$OUT4" | grep -q "FAIL=0" || { echo "SPRINT 4 TESTS FAILED"; exit 1; }
echo "== concurrency tests"
RACE=$("$HERE/20_race_test.sh" 2>&1); echo "$RACE" | grep -E "RESULT|ERROR|responses|ok:"
echo "$RACE" | grep -q "C balance=0  (must be 0, never negative)  unlock rows=1" || { echo "RACE 1 FAILED"; exit 1; }
echo "$RACE" | grep -q "D balance=3 (expect 3)  unlock rows=1 (expect 1)  unlock_top ledger rows=1 (expect 1)" || { echo "RACE 2 FAILED"; exit 1; }
echo "$RACE" | grep -q "RESULT  race3 OK" || { echo "RACE 3 FAILED (outbox double-claim)"; exit 1; }
echo "ALL TESTS PASSED"
