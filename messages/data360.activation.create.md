# summary

Create an activation.

# description

Creates an activation from JSON.

# examples

- Create from a file:
  <%= config.bin %> <%= command.id %> --target-org my-org --file activation.json
- Read stdin:
  <%= config.bin %> <%= command.id %> --target-org my-org --file - < activation.json

# flags.file.summary

JSON definition file, or - for stdin.
