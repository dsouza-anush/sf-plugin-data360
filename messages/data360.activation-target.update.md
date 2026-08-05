# summary

Update an activation target.

# description

Patches a target with maxFileSize from 1 through 500 MB.

# examples

- Update by name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name S3_Target --file target.json
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name S3_Target --file target.json --json

# flags.name.summary

Activation target name or ID.

# flags.file.summary

JSON definition file.

# error.D360_INVALID_DEFINITION

maxFileSize is outside 1 through 500 MB.

# error.D360_INVALID_DEFINITION.actions

Set maxFileSize to a number from 1 through 500.
