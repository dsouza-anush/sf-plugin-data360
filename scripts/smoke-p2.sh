#!/usr/bin/env bash
set -euo pipefail

org="${D360_LIVE_ORG:?set D360_LIVE_ORG to a Data 360 org alias or username}"

# Never write the exchanged JWT to a file or terminal log.
sf data360 token display --target-org "$org" --no-token-cache >/dev/null
sf data360 api request metadata --target-org "$org" --direct --no-token-cache >/dev/null
sf data360 doctor --target-org "$org" --json |
  jq -e '
    [.result.checks[]
      | select(.name == "Direct API token exchange"
        or .name == "Direct API ping"
        or .name == "Direct API scopes")
      | .status] == ["pass", "pass", "warn"]
  ' >/dev/null
