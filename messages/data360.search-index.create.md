# summary

Create a search index.

# description

Creates a verified search index definition.

# examples

- Create from a file:
  <%= config.bin %> <%= command.id %> --target-org my-org --file index.json
- Read stdin:
  <%= config.bin %> <%= command.id %> --target-org my-org --file - < index.json

# flags.file.summary

JSON definition file.
