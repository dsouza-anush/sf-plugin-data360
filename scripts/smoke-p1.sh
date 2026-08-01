#!/usr/bin/env bash
set -euo pipefail

org="${1:?usage: scripts/smoke-p1.sh <org-alias>}"
entity="${D360_SMOKE_ENTITY:-ssot__Account__dlm}"

sf data360 doctor --target-org "$org" --json >/dev/null
sf data360 metadata list --target-org "$org" --limit 5 --json >/dev/null
sf data360 metadata get --target-org "$org" --name "$entity" --json >/dev/null
if [[ "${D360_LIVE_BILLABLE:-0}" == "1" ]]; then
  sf data360 query --target-org "$org" --query "SELECT * FROM \"$entity\" LIMIT 1" --row-limit 1 --json >/dev/null
else
  echo "Skipping the billable query canary; set D360_LIVE_BILLABLE=1 only after credit approval." >&2
fi
sf data360 api request "data-spaces?batchSize=1" --target-org "$org" >/dev/null
echo "P1 read-only smoke passed." >&2
