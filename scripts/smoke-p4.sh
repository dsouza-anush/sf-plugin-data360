#!/usr/bin/env bash
set -euo pipefail

: "${D360_LIVE_ORG:?Set D360_LIVE_ORG to an authorized non-production Data 360 org.}"

sf data360 connector list -o "${D360_LIVE_ORG}" --json >/dev/null
sf data360 connection list -o "${D360_LIVE_ORG}" --json >/dev/null
sf data360 dlo list -o "${D360_LIVE_ORG}" --json >/dev/null
sf data360 dmo list -o "${D360_LIVE_ORG}" --json >/dev/null
sf data360 mapping list -o "${D360_LIVE_ORG}" --dmo ssot__Individual__dlm --json >/dev/null
sf data360 data-stream list -o "${D360_LIVE_ORG}" --json >/dev/null
sf data360 transform list -o "${D360_LIVE_ORG}" --json >/dev/null
sf data360 data-space list -o "${D360_LIVE_ORG}" --json >/dev/null

if [[ "${D360_LIVE_MUTATIONS:-0}" != "1" ]]; then
  echo "P4 read-only smoke passed; mutation smoke remains gated." >&2
  exit 0
fi

: "${D360_DISPOSABLE_CONNECTION_DEFINITION:?Set a disposable connection definition.}"
echo "P4 mutations require disposable resources and are intentionally not automated in this slice." >&2
exit 2
