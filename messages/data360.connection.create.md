# summary

Create a Data 360 connection.

# description

Create a Data 360 connection. Uses verified Data 360 Connect API endpoints and supports global JSON output.

# examples

- Run the command against the configured org:
  <%= config.bin %> <%= command.id %> --target-org my-org --file -
- Run the command with machine-readable output:
  <%= config.bin %> <%= command.id %> --target-org my-org --file - --json

# flags.file.summary

Path to the JSON definition file, or `-` to read it from stdin.

# error.D360_API_ERROR

The Data 360 API rejected the request.

# error.D360_API_ERROR.actions

Re-run with --json and correct the request.
