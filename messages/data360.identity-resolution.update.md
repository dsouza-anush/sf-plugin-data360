# summary

Update an identity resolution ruleset.

# description

Updates a ruleset from a JSON definition.

# examples

- Update by name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Main --file ruleset.json
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Main --file ruleset.json --json

# flags.name.summary

Identity resolution ruleset name, label, or ID.

# flags.file.summary

JSON definition file, or - for stdin.
