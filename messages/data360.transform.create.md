# summary

Create a data transform.

# description

Create a transform from a JSON definition read from a file or standard input.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --file -
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --file - --json

# flags.file.summary

Path to the JSON definition file, or `-` to read it from stdin.

# error.D360_API_ERROR

Transform request failed.

# error.D360_API_ERROR.actions

Re-run with --json.
