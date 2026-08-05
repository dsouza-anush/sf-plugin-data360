# summary

Get a Data Lake Object.

# description

Get a Data Lake Object. Uses the verified Data 360 Data Lake Object endpoint.

# examples

- Run against a target org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example
- Run with machine-readable output:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# error.D360_API_ERROR

The Data Lake Object request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the definition or resource name.
