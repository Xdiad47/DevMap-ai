#!/bin/bash
# Spins up Postgres 15 (+ Supabase stand-ins + the real migration) and PostgREST in Docker, then runs the
# contract test against them. Everything is removed afterwards.   Usage: npm run test:contract
set -e
cd "$(dirname "$0")/.."
NET=devmap-ct-net; PG=devmap-ct-pg; REST=devmap-ct-rest; DB=devmap_test
SECRET=$(openssl rand -hex 24)   # 48 chars; PostgREST needs >= 32
cleanup() { docker rm -f $PG $REST >/dev/null 2>&1 || true; docker network rm $NET >/dev/null 2>&1 || true; }
cleanup; trap cleanup EXIT

docker network create $NET >/dev/null
docker run -d --name $PG --network $NET -e POSTGRES_PASSWORD=pw "${PG_IMAGE:-postgres:17}" >/dev/null
until docker exec $PG pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done; sleep 4
P="docker exec -i $PG psql -U postgres"
$P -q -c "create database $DB"
$P -d $DB -v ON_ERROR_STOP=1 -q < supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  $P -d $DB -v ON_ERROR_STOP=1 -1 -q < "$f" 2>&1 | grep -v "already exists, skipping" || true
done
$P -d $DB -v ON_ERROR_STOP=1 -q < supabase/seed.sql 2>&1 | grep -E "seed:|ERROR" || true

docker run -d --name $REST --network $NET -p 3333:3000 \
  -e PGRST_DB_URI="postgres://postgres:pw@$PG:5432/$DB" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" postgrest/postgrest >/dev/null
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3333/ && break; sleep 1; done

export CT_CONTAINER=$PG CT_DB=$DB CT_POSTGREST_URL=http://localhost:3333 CT_JWT_SECRET="$SECRET"
# Separate runs, in this order: the later suites strike / ban / ping SEED profiles, which would skew the earlier ones' assertions.
npx vitest run src/lib/rpc.contract.test.ts src/lib/discovery.contract.test.ts
npx vitest run src/lib/sprint3.contract.test.ts
npx vitest run src/lib/sprint4.contract.test.ts
