# summary

Get a Data Model Object.

# description

Get a Data Model Object. Uses verified Data 360 Data Model Object endpoints.

# examples

- Run against a target org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example
- Run with machine-readable output:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# error.D360_API_ERROR

The Data Model Object request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the definition or resource name.
