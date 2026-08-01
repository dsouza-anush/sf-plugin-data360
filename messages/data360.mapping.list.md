# summary

List Data Model Object mappings.

# description

List Data Model Object mappings. Uses verified mapping endpoints.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --dmo Example__dlm
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --dmo Example__dlm --json

# flags.dmo.summary

Target Data Model Object developer name.

# flags.source-object.summary

DLO developer name used to further filter the target DMO mappings.

# flags.all.summary

Return all mapping records.

# flags.limit.summary

Maximum mapping records to return.

# flags.result-format.summary

Output format: human, CSV, or JSON.

# error.D360_API_ERROR

Mapping request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the mapping.

# error.D360_INVALID_DEFINITION

Target DMO developer name is required.

# error.D360_INVALID_DEFINITION.actions

The Connect API requires --dmo as the primary scope. Use --source-object with --dmo to filter by DLO developer name.

# error.D360_INVALID_DEFINITION.0

Target DMO developer name is required.

# error.D360_INVALID_DEFINITION.0.actions.1

The Connect API requires --dmo as the primary scope. Use --source-object with --dmo to filter by DLO developer name.
