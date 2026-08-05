# summary

Create an identity resolution ruleset.

# description

Creates a ruleset from a JSON definition.

# examples

- Create from a file:
  <%= config.bin %> <%= command.id %> --target-org my-org --file ruleset.json
- Read from stdin:
  <%= config.bin %> <%= command.id %> --target-org my-org --file - < ruleset.json

# flags.file.summary

JSON definition file, or - for stdin.
