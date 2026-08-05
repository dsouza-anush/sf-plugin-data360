# summary

Get a calculated insight.

# description

Gets one definition by API name or display name.

# examples

- Get by API name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Revenue__cio
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Revenue__cio --json

# flags.name.summary

Calculated insight API name or display name.

# error.D360_INVALID_DEFINITION

The resolved API name does not end with __cio.

# error.D360_INVALID_DEFINITION.actions

Use an API name ending in __cio.
