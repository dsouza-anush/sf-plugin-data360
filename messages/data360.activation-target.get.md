# summary

Get an activation target.

# description

Gets an activation target by name or ID.

# examples

- Get by name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name S3_Target
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name S3_Target --json

# flags.name.summary

Activation target name or ID.
