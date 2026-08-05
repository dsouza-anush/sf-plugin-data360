# summary

List Data 360 connections.

# description

List Data 360 connections. Uses verified Data 360 Connect API endpoints and supports global JSON output.

# examples

- Run the command against the configured org:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Run the command with machine-readable output:
  <%= config.bin %> <%= command.id %> --target-org my-org --json

# flags.connector-type.summary

Connector type used to filter connections.

# flags.limit.summary

Maximum number of connections to return unless --all is set.

# flags.all.summary

Return all connections across every selected connector type.

# error.D360_API_ERROR

The Data 360 API rejected the request.

# error.D360_API_ERROR.actions

Re-run with --json and correct the request.
