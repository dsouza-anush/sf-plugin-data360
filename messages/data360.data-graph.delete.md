# summary

Delete a data graph.

# description

Deletes a source-verified data graph after confirmation.

# examples

- Delete interactively:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Customer_Graph
- Delete in automation:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Customer_Graph --no-prompt

# flags.name.summary

Data graph name.

# flags.no-prompt.summary

Proceed without prompting.
