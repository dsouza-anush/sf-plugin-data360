# summary

Delete a data transform.

# description

Delete a transform definition after confirmation. Use `--no-prompt` only in reviewed automation.

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
