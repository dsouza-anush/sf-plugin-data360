# summary

Describe search index configuration.

# description

Reads verified chunking, embedding, and similarity configuration.

# examples

- Describe by name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Knowledge_Index
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Knowledge_Index --json

# flags.name.summary

Search index name or ID.
