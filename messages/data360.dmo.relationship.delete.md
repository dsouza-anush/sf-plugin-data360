# summary

Delete a Data Model Object relationship.

# description

Delete a Data Model Object relationship. Uses verified Data 360 Data Model Object endpoints.

# examples

- Run against a target org:
  <%= config.bin %> <%= command.id %> --target-org my-org --relationship-name Example --no-prompt
- Run with machine-readable output:
  <%= config.bin %> <%= command.id %> --target-org my-org --relationship-name Example --no-prompt --json

# flags.relationship-name.summary

Developer name of the relationship to delete. The live delete endpoint does not accept the relationship record ID.

# flags.no-prompt.summary

Skip the confirmation prompt.

# error.D360_API_ERROR

The Data Model Object request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the definition or resource name.

# runtime.confirmDestructive.0

Delete relationship %s?
