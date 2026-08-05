# summary

Get an identity resolution ruleset.

# description

Gets one ruleset by exact name, label, or ID.

# examples

- Get by name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Main
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Main --json

# flags.name.summary

Identity resolution ruleset name, label, or ID.
