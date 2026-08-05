# summary

Update mapping fields using one PATCH per field.

# description

Update mapping fields using one PATCH per field. Uses verified mapping endpoints.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --file -
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --file - --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# flags.file.summary

Path to the JSON definition file, or `-` to read it from stdin.

# error.D360_API_ERROR

Mapping request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the mapping.

# error.D360_INVALID_DEFINITION.0

Mapping update file must contain fieldMappings array.

# error.D360_INVALID_DEFINITION.0.actions.1

Wrap field definitions in {"fieldMappings":[...]}.
