# summary

Query calculated insight values or metadata.

# description

Reads values with verified filters or describes insight metadata.

# examples

- Query selected values:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Revenue__cio --dimensions Country --measures Revenue --time-granularity DAY
- Describe the insight:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Revenue__cio --describe --json

# flags.name.summary

Calculated insight API name or display name.

# flags.dimensions.summary

Comma-separated dimensions.

# flags.measures.summary

Comma-separated measures.

# flags.filters.summary

Calculated insight filter expression.

# flags.time-granularity.summary

Time granularity.

# flags.describe.summary

Return calculated insight metadata.

# error.D360_INVALID_DEFINITION

The resolved API name does not end with __cio.

# error.D360_INVALID_DEFINITION.actions

Use an API name ending in __cio.
