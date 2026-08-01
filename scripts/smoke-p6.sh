#!/bin/sh
set -eu

ORG="${D360_LIVE_ORG:?set D360_LIVE_ORG to a verified Data 360 org}"

sf data360 retriever list --target-org "$ORG" --limit 1 --json >/dev/null
sf data360 retriever get --target-org "$ORG" --name SalesforceHelpContentRetriever --json >/dev/null
sf data360 retriever configuration list --target-org "$ORG" --name SalesforceHelpContentRetriever --limit 1 --json >/dev/null
sf data360 docai describe --target-org "$ORG" --json >/dev/null
echo "P6 read-only smoke passed." >&2
