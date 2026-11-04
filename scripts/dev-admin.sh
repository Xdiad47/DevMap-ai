#!/bin/bash
# Makes an e-mail an admin on your LOCAL stack:   bash scripts/dev-admin.sh you@example.com
# (they must have signed in once; then sign out and in again)
set -e
cd "$(dirname "$0")/.."
[ -n "$1" ] || { echo "Usage: bash scripts/dev-admin.sh you@example.com"; exit 1; }
ENVS=$(npx supabase status -o env 2>/dev/null)
get() { echo "$ENVS" | sed -n "s/^$1=\"\(.*\)\"$/\1/p"; }
SUPABASE_URL=$(get API_URL) SUPABASE_SERVICE_ROLE_KEY=$(get SERVICE_ROLE_KEY) node scripts/make-admin.mjs "$1"
