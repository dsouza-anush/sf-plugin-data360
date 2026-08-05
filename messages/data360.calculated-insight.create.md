# summary

Create a calculated insight.

# description

Creates a definition whose API name ends with __cio.

# examples

- Create from a file:
  <%= config.bin %> <%= command.id %> --target-org my-org --file insight.json
- Read from stdin:
  <%= config.bin %> <%= command.id %> --target-org my-org --file - < insight.json

# flags.file.summary

JSON definition file, or - for stdin.

# error.D360_INVALID_DEFINITION

The definition API name does not end with __cio.

# error.D360_INVALID_DEFINITION.actions

Use an API name ending in __cio.
