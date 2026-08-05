# summary

Create a data space.

# description

Create a data space from a JSON definition read from a file or standard input.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --file -
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --file - --json

# flags.file.summary

Path to the JSON definition file, or `-` to read it from stdin.

# error.D360_API_ERROR

Data-space request failed.

# error.D360_API_ERROR.actions

Re-run with --json.
