# summary

List data spaces.

# description

List the Data 360 data spaces available to the target user.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --json

# error.D360_API_ERROR

Data-space request failed.

# error.D360_API_ERROR.actions

Re-run with --json.
