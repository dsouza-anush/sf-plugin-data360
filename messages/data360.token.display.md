# summary

Display a Data 360 Direct API token.

# description

Exchange the target org access token for a short-lived Data 360 tenant token and display its tenant URL, expiry, and scopes.

# examples

- Display a token for curl in a trusted terminal:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Return the documented token fields in the standard JSON envelope:
  <%= config.bin %> <%= command.id %> --target-org my-org --json

# flags.no-token-cache.summary

Exchange a new token without reading or writing the encrypted cache.

# error.D360_TOKEN_EXCHANGE_FAILED

The Data 360 token exchange failed.

# error.D360_TOKEN_EXCHANGE_FAILED.actions

Check the External Client App and its `cdp_*` scopes, then run `sf data360 doctor`.

# error.RUNTIME_0.0

Unable to resolve the target org username.

# runtime.status.1

Warning: the access token is a secret. Prefer --flags-dir or environment variables in CI.

# runtime.instance-url

Instance URL: %s

# runtime.expires-at

Expires at: %s
