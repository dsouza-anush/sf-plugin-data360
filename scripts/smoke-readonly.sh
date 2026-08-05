#!/usr/bin/env bash
set -euo pipefail

: "${D360_LIVE_ORG:?Set D360_LIVE_ORG to an authorized non-production Data 360 org.}"

for gate in D360_LIVE_MUTATIONS D360_LIVE_BILLABLE; do
  if [[ "${!gate:-0}" != "0" ]]; then
    echo "Read-only smoke refuses inherited ${gate}; unset it or set it to 0." >&2
    exit 2
  fi
done

export D360_LIVE_MUTATIONS=0
export D360_LIVE_BILLABLE=0

scripts/smoke-p1.sh "${D360_LIVE_ORG}"
scripts/smoke-p2.sh
scripts/smoke-p4.sh
scripts/smoke-p5.sh
scripts/smoke-p6.sh
