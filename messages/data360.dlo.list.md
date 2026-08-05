# summary

List Data Lake Objects.

# description

List Data Lake Objects. Uses the verified Data 360 Data Lake Object endpoint.

# examples

- Run against a target org:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Run with machine-readable output:
  <%= config.bin %> <%= command.id %> --target-org my-org --json

# error.D360_API_ERROR

The Data Lake Object request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the definition or resource name.
