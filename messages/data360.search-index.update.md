# summary

Update a search index.

# description

Patches a verified search index definition.

# examples

- Update by name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Knowledge_Index --file index.json
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Knowledge_Index --file index.json --json

# flags.name.summary

Search index name or ID.

# flags.file.summary

JSON definition file.
