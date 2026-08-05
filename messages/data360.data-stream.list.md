# summary

List data streams.

# description

List data streams. Uses verified data-stream endpoints.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --json

# error.D360_API_ERROR

Data stream request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the stream.
