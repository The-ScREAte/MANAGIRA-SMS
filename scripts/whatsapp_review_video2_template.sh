#!/usr/bin/env bash
set -euo pipefail

ACCESS_TOKEN="${ACCESS_TOKEN:-}"
WABA_ID="${WABA_ID:-1575110227665982}"
TEMPLATE_NAME="${TEMPLATE_NAME:-managira_order_update_v2}"

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "Missing ACCESS_TOKEN env var"
  echo "Run: export ACCESS_TOKEN='YOUR_FRESH_TOKEN'"
  exit 1
fi

curl -i -X POST \
  "https://graph.facebook.com/v25.0/${WABA_ID}/message_templates" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'"${TEMPLATE_NAME}"'",
    "language": "en_US",
    "category": "UTILITY",
    "components": [
      { "type": "BODY", "text": "Hi {{1}}, your order {{2}} has been received." }
    ]
  }'
