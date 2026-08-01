# summary

List Data 360 data actions.

# description

List data actions from the live-verified data action collection.

# examples

- List data actions:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Return all data actions as JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --all --json

# flags.all.summary

Fetch all available data actions.

# flags.limit.summary

Maximum number of data actions to return.

# flags.result-format.summary

Format data action rows as human, CSV, or JSON output.
