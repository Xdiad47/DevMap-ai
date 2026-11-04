#!/bin/bash
# One command to run DevMap locally (Docker must be running):   bash scripts/dev-up.sh [--reset] [--no-dev]
#   --reset   wipe the local database back to the 15 seed profiles first
#   --no-dev  set everything up but don't start the web server
set -e
cd "$(dirname "$0")/.."
docker info >/dev/null 2>&1 || { echo "Docker isn't running. Start Docker Desktop first."; exit 1; }
[ -d node_modules ] || npm install

echo "== starting Supabase (first run downloads images, be patient)"
npx supabase start >/dev/null 2>&1 || npx supabase start
[ "$1" = "--reset" ] && npx supabase db reset >/dev/null 2>&1 && echo "== database reset to seed data"

ENVS=$(npx supabase status -o env 2>/dev/null)
get() { echo "$ENVS" | sed -n "s/^$1=\"\(.*\)\"$/\1/p"; }
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  sed -i.bak "s|^NEXT_PUBLIC_SUPABASE_URL=.*|NEXT_PUBLIC_SUPABASE_URL=$(get API_URL)|; s|^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*|NEXT_PUBLIC_SUPABASE_ANON_KEY=$(get ANON_KEY)|; s|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=$(get SERVICE_ROLE_KEY)|" .env.local && rm .env.local.bak
  echo "== wrote .env.local with your local keys"
fi

echo
echo "  App:      http://localhost:3000"
echo "  Emails:   http://127.0.0.1:54324   (sign-in codes + client confirmation emails)"
echo "  Phone OTP for testing: 98765 43210   code 123456"
echo
[ "$2" = "--no-dev" ] || [ "$1" = "--no-dev" ] && exit 0
exec npm run dev
