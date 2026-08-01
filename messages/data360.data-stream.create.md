# summary

Create a data stream.

# description

Create a data stream. Uses verified data-stream endpoints.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --file -
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --file - --json

# flags.file.summary

Path to the JSON definition file, or `-` to read it from stdin.

# error.D360_API_ERROR

Data stream request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the stream.
