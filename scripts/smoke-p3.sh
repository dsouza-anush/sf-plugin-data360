#!/usr/bin/env bash
set -euo pipefail

: "${D360_LIVE_ORG:?Set D360_LIVE_ORG to a dedicated Data 360 test org.}"
: "${D360_LIVE_MUTATIONS:?Set D360_LIVE_MUTATIONS=1 after mutation approval.}"
[[ "${D360_LIVE_MUTATIONS}" == "1" ]] || { echo "D360_LIVE_MUTATIONS must equal 1." >&2; exit 1; }
: "${D360_LIVE_BILLABLE:?Set D360_LIVE_BILLABLE=1 after credit approval.}"
[[ "${D360_LIVE_BILLABLE}" == "1" ]] || { echo "D360_LIVE_BILLABLE must equal 1." >&2; exit 1; }
: "${D360_INGEST_SOURCE:?Set D360_INGEST_SOURCE.}"
: "${D360_INGEST_OBJECT:?Set D360_INGEST_OBJECT.}"
: "${D360_INGEST_SAMPLE:?Set D360_INGEST_SAMPLE to a valid JSON or NDJSON sample.}"
: "${D360_INGEST_INVALID_SAMPLE:?Set D360_INGEST_INVALID_SAMPLE to a schema-invalid sample.}"
: "${D360_INGEST_CSV:?Set D360_INGEST_CSV to a three-row CSV.}"
: "${D360_INGEST_VERIFY_SQL:?Set D360_INGEST_VERIFY_SQL to find the disposable records.}"

common=(-o "${D360_LIVE_ORG}" -s "${D360_INGEST_SOURCE}" --object-name "${D360_INGEST_OBJECT}")

echo "Running approved billable P3 smoke against the pinned live org." >&2
sf data360 ingest validate "${common[@]}" -f "${D360_INGEST_SAMPLE}" --json >/dev/null
sf data360 ingest bulk "${common[@]}" -f "${D360_INGEST_CSV}" --wait 10 --json >/dev/null
sf data360 ingest "${common[@]}" -f "${D360_INGEST_SAMPLE}" --json >/dev/null

if sf data360 ingest validate "${common[@]}" -f "${D360_INGEST_INVALID_SAMPLE}" --json >/dev/null 2>&1; then
  echo "Expected schema-invalid validation to fail." >&2
  exit 1
fi

for attempt in {1..20}; do
  if sf data360 query -o "${D360_LIVE_ORG}" -q "${D360_INGEST_VERIFY_SQL}" --json |
    jq -e '.result.rows | length > 0' >/dev/null; then
    echo "P3 live ingestion smoke passed." >&2
    exit 0
  fi
  echo "Waiting for ingestion consistency (${attempt}/20)." >&2
  sleep 30
done

echo "Ingested rows were not query-visible within 10 minutes." >&2
exit 1
