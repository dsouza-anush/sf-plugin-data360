# summary

Update a Data Lake Object.

# description

Update a Data Lake Object. Uses the verified Data 360 Data Lake Object endpoint.

# examples

- Run against a target org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --file -
- Run with machine-readable output:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --file - --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# flags.file.summary

Path to the JSON definition file, or `-` to read it from stdin.

# error.D360_API_ERROR

The Data Lake Object request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the definition or resource name.
