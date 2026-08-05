# summary

Get a data stream.

# description

Get a data stream. Uses verified data-stream endpoints.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# error.D360_API_ERROR

Data stream request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the stream.
