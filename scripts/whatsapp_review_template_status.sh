#!/usr/bin/env bash
set -euo pipefail

ACCESS_TOKEN="${ACCESS_TOKEN:-}"
WABA_ID="${WABA_ID:-1575110227665982}"

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "Missing ACCESS_TOKEN env var"
  echo "Run: export ACCESS_TOKEN='YOUR_FRESH_TOKEN'"
  exit 1
fi

curl -sS -X GET \
  "https://graph.facebook.com/v25.0/${WABA_ID}/message_templates?fields=name,status,language,category" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
