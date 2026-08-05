# summary

List Data 360 connector types.

# description

List verified connector types and their ingestion categories and modes.

# examples

- List connector types for an org:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Return every connector as JSON:
  <%= config.bin %> <%= command.id %> --all --json --target-org my-org

# error.D360_API_ERROR

The connector API request failed.

# error.D360_API_ERROR.actions

Re-run with --json and verify Data 360 provisioning.
