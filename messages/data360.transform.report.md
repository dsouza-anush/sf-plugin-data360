# summary

Report data transform status.

# description

Verified transform operation.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# flags.history.summary

Include transform run history in the report.

# error.D360_API_ERROR

Transform request failed.

# error.D360_API_ERROR.actions

Re-run with --json.
