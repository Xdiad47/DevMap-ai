#!/bin/bash
# End-to-end test against the REAL local Supabase stack. Start it first:  npx supabase start
set -e
cd "$(dirname "$0")/.."
ENV=$(npx supabase status -o env)
export E2E_API_URL=$(echo "$ENV" | sed -n 's/^API_URL="\(.*\)"$/\1/p')
export E2E_ANON_KEY=$(echo "$ENV" | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')
export E2E_SERVICE_KEY=$(echo "$ENV" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')
[ -n "$E2E_API_URL" ] && [ -n "$E2E_ANON_KEY" ] || { echo "Supabase isn't running. Run: npx supabase start"; exit 1; }
# sequential: the first resets local test data, the second adds to it
npx vitest run src/lib/auth.e2e.test.ts
npx vitest run src/lib/sprint4.e2e.test.ts
