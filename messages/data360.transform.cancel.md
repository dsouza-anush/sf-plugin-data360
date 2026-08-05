# summary

Cancel a data transform.

# description

Request cancellation of a running transform. This command doesn't delete the transform definition.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --no-prompt
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --no-prompt --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# flags.no-prompt.summary

Skip the confirmation prompt.

# error.D360_API_ERROR

Transform request failed.

# error.D360_API_ERROR.actions

Re-run with --json.

# runtime.confirmDestructive.0

Cancel transform %s?
