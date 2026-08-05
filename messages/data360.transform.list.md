# summary

List data transforms.

# description

List the transforms available to the target org and data space.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --json

# error.D360_API_ERROR

Transform request failed.

# error.D360_API_ERROR.actions

Re-run with --json.
