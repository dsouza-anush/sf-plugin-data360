# summary

Send a raw authenticated Data 360 API request.

# description

Call a core-org or Direct tenant Data 360 endpoint and write the response body to stdout without a JSON envelope. POST, PUT, PATCH, and DELETE require explicit confirmation.

# examples

- Fetch one segment page:
  <%= config.bin %> <%= command.id %> 'segments?batchSize=1' --target-org my-org
- Submit a JSON payload from a file and include response headers:
  <%= config.bin %> <%= command.id %> connections --method POST --body @connection.json --include --target-org my-org
- Fetch Direct API metadata with an exchanged tenant token:
  <%= config.bin %> <%= command.id %> metadata --direct --target-org my-org

# flags.method.summary

HTTP request method.

# flags.header.summary

Request header in `name:value` format; repeat for multiple headers.

# flags.body.summary

Literal body, `@file`, or `-` for stdin.

# flags.direct.summary

Send the request to the Data 360 tenant API.

# flags.no-token-cache.summary

Exchange a new token without reading or writing the encrypted cache.

# error.D360_API_ERROR

The raw Data 360 request failed.

# error.D360_API_ERROR.actions

Inspect the returned status and body, then correct the endpoint or payload.

# error.D360_SCOPE_MISSING

The Direct API rejected the request because its required `cdp_*` scope is missing.

# error.D360_SCOPE_MISSING.actions

Add the scope named in the error to the External Client App, authorize the org again, and run `sf data360 doctor`.

# error.D360_TOKEN_EXCHANGE_FAILED

The Direct API token exchange failed or returned an unapproved tenant URL.

# error.D360_TOKEN_EXCHANGE_FAILED.actions

Verify the External Client App configuration and run `sf data360 doctor`.

# flags.endpoint.description

Relative SSOT or absolute /services endpoint.

# flags.include.summary

Include response status and headers.

# flags.stream-to-file.summary

Write response bytes atomically to a file.

# error.RUNTIME_0.0

Unable to resolve the target org username.

# runtime.confirmMutation

Send raw %s request to %s? Raw mutating requests can change or delete Data 360 resources.
