# summary

Create an activation target.

# description

Creates a target with maxFileSize from 1 through 500 MB.

# examples

- Create from a file:
  <%= config.bin %> <%= command.id %> --target-org my-org --file target.json
- Read stdin:
  <%= config.bin %> <%= command.id %> --target-org my-org --file - < target.json

# flags.file.summary

JSON definition file.

# error.D360_INVALID_DEFINITION

maxFileSize is outside 1 through 500 MB.

# error.D360_INVALID_DEFINITION.actions

Set maxFileSize to a number from 1 through 500.
