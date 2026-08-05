# summary

Delete a mapping or selected field mappings.

# description

Delete a mapping or selected field mappings. Uses verified mapping endpoints.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --no-prompt
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --no-prompt --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# flags.fields.summary

Comma-separated field mapping developer names to delete.

# flags.no-prompt.summary

Skip the confirmation prompt.

# error.D360_API_ERROR

Mapping request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the mapping.

# error.D360_INVALID_DEFINITION

The --fields value must contain at least one field name.

# error.D360_INVALID_DEFINITION.actions

Provide a comma-separated field list, or omit --fields to delete the entire mapping.

# runtime.confirmDestructive.0

Delete mapping %s?
