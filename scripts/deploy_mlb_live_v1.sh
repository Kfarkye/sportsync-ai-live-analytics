#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${PROJECT_REF:-qffzvrnbzabcokqqrwbv}"
PUBLIC_APP_BASE_URL="${PUBLIC_APP_BASE_URL:-https://sportsync-evidence.web.app}"
SUPABASE_URL="${SUPABASE_URL:-https://${PROJECT_REF}.supabase.co}"
DEPLOY_FRONTEND="${DEPLOY_FRONTEND:-1}"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $cmd" >&2
    exit 1
  fi
}

require_env() {
  local var="$1"
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: required env var is missing: $var" >&2
    exit 1
  fi
}

require_cmd supabase
require_cmd vercel
require_cmd node
require_env SUPABASE_SERVICE_ROLE_KEY

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

echo "==> MLB Live V1 deploy started"
echo "    project_ref=${PROJECT_REF}"
echo "    public_app_base_url=${PUBLIC_APP_BASE_URL}"
echo "    deploy_frontend=${DEPLOY_FRONTEND}"

echo "==> Step 1/6: supabase link"
supabase link --project-ref "$PROJECT_REF"

echo "==> Step 2/6: supabase db push --linked"
if [[ -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
  supabase db push --linked -p "$SUPABASE_DB_PASSWORD"
else
  supabase db push --linked
fi

echo "==> Step 3/6: set PUBLIC_APP_BASE_URL secret"
supabase secrets set "PUBLIC_APP_BASE_URL=${PUBLIC_APP_BASE_URL}" --project-ref "$PROJECT_REF"

echo "==> Step 4/6: deploy edge function mlb-live-url-context"
supabase functions deploy mlb-live-url-context --project-ref "$PROJECT_REF" --use-api

if [[ "$DEPLOY_FRONTEND" == "1" ]]; then
  echo "==> Step 5/6: vercel --prod"
  vercel --prod
else
  echo "==> Step 5/6: skipped frontend deploy (DEPLOY_FRONTEND=${DEPLOY_FRONTEND})"
fi

echo "==> Step 6/6: smoke test"
export SUPABASE_URL
export SUPABASE_SERVICE_ROLE_KEY
node scripts/smoke_mlb_live_url_context.mjs

echo "==> MLB Live V1 deploy complete"
echo "    Next verification (SQL):"
echo "    SELECT ts_utc, game_id, trigger, confidence, severity FROM public.mlb_live_insight_receipts ORDER BY ts_utc DESC LIMIT 20;"
echo "    SELECT game_id, trigger, COUNT(*) FROM public.mlb_live_insight_receipts WHERE ts_utc > now() - interval '15 minutes' GROUP BY 1,2 ORDER BY 3 DESC;"
