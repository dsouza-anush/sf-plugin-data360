#!/usr/bin/env bash
set -euo pipefail

: "${D360_LIVE_ORG:?Set D360_LIVE_ORG to an authorized non-production Data 360 org.}"

sf data360 identity-resolution list -o "${D360_LIVE_ORG}" --json >/dev/null
sf data360 calculated-insight list -o "${D360_LIVE_ORG}" --json >/dev/null
sf data360 segment list -o "${D360_LIVE_ORG}" --json >/dev/null
sf data360 activation list -o "${D360_LIVE_ORG}" --json >/dev/null
sf data360 activation platforms -o "${D360_LIVE_ORG}" --json >/dev/null
sf data360 activation-target list -o "${D360_LIVE_ORG}" --json >/dev/null
sf data360 search-index list -o "${D360_LIVE_ORG}" --json >/dev/null
sf data360 data-graph list -o "${D360_LIVE_ORG}" --json >/dev/null
sf data360 profile describe -o "${D360_LIVE_ORG}" --json >/dev/null

if [[ "${D360_LIVE_MUTATIONS:-0}" != "1" ]]; then
  echo "P5 read-only smoke passed; mutation and billable smoke remain gated." >&2
  exit 0
fi

: "${D360_LIVE_BILLABLE:-0}"
if [[ "${D360_LIVE_BILLABLE}" != "1" ]]; then
  echo "P5 mutations enabled, but billable operations remain gated." >&2
  exit 0
fi

echo "P5 billable operations require disposable named resources and are intentionally not run by default." >&2
exit 2
