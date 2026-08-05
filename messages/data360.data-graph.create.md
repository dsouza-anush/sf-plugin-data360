# summary

Create a data graph.

# description

Creates a source-verified data graph definition.

# examples

- Create from a file:
  <%= config.bin %> <%= command.id %> --target-org my-org --file graph.json
- Read stdin:
  <%= config.bin %> <%= command.id %> --target-org my-org --file - < graph.json

# flags.file.summary

JSON definition file.
