#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/supabase/.env.functions"

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI not found. Install it first: https://supabase.com/docs/guides/cli"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy supabase/.env.functions.example first."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required_vars=(OPENAI_API_KEY RESEND_API_KEY EXPENSE_EMAIL_FROM)
for key in "${required_vars[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required value in $ENV_FILE: $key"
    exit 1
  fi
done

PROJECT_REF="${SUPABASE_PROJECT_REF:-ibjocekpexrmpkyuhgtv}"

echo "Linking project: $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF"

echo "Setting edge function secrets"
supabase secrets set OPENAI_API_KEY="$OPENAI_API_KEY"
supabase secrets set OPENAI_RECEIPT_MODEL="${OPENAI_RECEIPT_MODEL:-gpt-4.1-mini}"
supabase secrets set RESEND_API_KEY="$RESEND_API_KEY"
supabase secrets set EXPENSE_EMAIL_FROM="$EXPENSE_EMAIL_FROM"

echo "Deploying edge functions"
supabase functions deploy extract-receipt-expense --no-verify-jwt
supabase functions deploy email-expenses-update --no-verify-jwt

echo "Done."
