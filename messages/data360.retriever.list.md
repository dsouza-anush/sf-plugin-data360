# summary

List verified Data 360 retrievers.

# description

List retrievers from the live-verified Data 360 retriever collection.

# examples

- List retrievers in the configured org:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Return all retrievers as JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --all --json

# flags.all.summary

Fetch all available retrievers.

# flags.limit.summary

Maximum number of retrievers to return.

# flags.result-format.summary

Format retriever rows as human, CSV, or JSON output.

# error.D360_API_ERROR

The retriever request failed.

# error.D360_API_ERROR.actions

Run sf data360 doctor and confirm retriever access.
