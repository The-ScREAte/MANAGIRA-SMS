#!/usr/bin/env bash
set -euo pipefail

ACCESS_TOKEN="${ACCESS_TOKEN:-}"
PHONE_NUMBER_ID="${PHONE_NUMBER_ID:-1149779811558777}"
TO="${TO:-13854521960}"

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "Missing ACCESS_TOKEN env var"
  echo "Run: export ACCESS_TOKEN='YOUR_FRESH_TOKEN'"
  exit 1
fi

curl -i -X POST \
  "https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "'"${TO}"'",
    "type": "template",
    "template": {
      "name": "jaspers_market_order_confirmation_v1",
      "language": { "code": "en_US" },
      "components": [
        {
          "type": "body",
          "parameters": [
            { "type": "text", "text": "Managira Support" },
            { "type": "text", "text": "MGR-20260629" },
            { "type": "text", "text": "June 30, 2026" }
          ]
        }
      ]
    }
  }'
