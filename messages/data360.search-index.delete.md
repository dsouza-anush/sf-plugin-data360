# summary

Delete a search index.

# description

Deletes a verified search index after confirmation.

# examples

- Delete interactively:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Knowledge_Index
- Delete in automation:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Knowledge_Index --no-prompt

# flags.name.summary

Search index name or ID.

# flags.no-prompt.summary

Proceed without prompting.
