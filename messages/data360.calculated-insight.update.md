# summary

Update a calculated insight.

# description

Updates a verified calculated insight definition.

# examples

- Update a definition:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Revenue__cio --file insight.json
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Revenue__cio --file insight.json --json

# flags.name.summary

Calculated insight API name or display name.

# flags.file.summary

JSON definition file, or - for stdin.

# error.D360_INVALID_DEFINITION

The calculated insight API name does not end with __cio.

# error.D360_INVALID_DEFINITION.actions

Use an API name ending in __cio.
