# summary

Get a Data Model Object mapping.

# description

Get a Data Model Object mapping. Uses verified mapping endpoints.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --json

# flags.name.summary

Exact mapping developer name.

# flags.dmo.summary

Target Data Model Object developer name used to resolve a mapping.

# flags.source-object.summary

DLO developer name used with --dmo to resolve a mapping.

# error.D360_API_ERROR

Mapping request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the mapping.

# error.D360_INVALID_DEFINITION

The mapping selector is invalid: pass an exact mapping name, or a target DMO scope, but not both.

# error.D360_INVALID_DEFINITION.actions

Pass --name by itself, or pass --dmo with optional --source-object.

# error.D360_INVALID_DEFINITION.0

Choose either an exact mapping name or mapping filters, not both.

# error.D360_INVALID_DEFINITION.0.actions.1

Pass --name by itself, or pass --dmo with optional --source-object.

# error.D360_INVALID_DEFINITION.1

An exact mapping name or target DMO scope is required.

# error.D360_INVALID_DEFINITION.1.actions.1

Pass --name, or pass --dmo with optional --source-object. The Connect API requires --dmo as the primary list scope.

# error.D360_NAME_AMBIGUOUS

The mapping name matches multiple resources.

# error.D360_NAME_AMBIGUOUS.actions

Retry with the resource ID or a unique API name.

# error.D360_NAME_NOT_FOUND

No mapping matches the requested name.

# error.D360_NAME_NOT_FOUND.actions

Retry with the resource ID or API name.
