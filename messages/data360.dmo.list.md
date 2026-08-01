# summary

List Data Model Objects.

# description

List Data Model Objects. Uses verified Data 360 Data Model Object endpoints.

# examples

- Run against a target org:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Run with machine-readable output:
  <%= config.bin %> <%= command.id %> --target-org my-org --json

# error.D360_API_ERROR

The Data Model Object request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the definition or resource name.
