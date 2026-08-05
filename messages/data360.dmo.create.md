# summary

Create a Data Model Object from a definition or Data Lake Object.

# description

Create a Data Model Object from a definition or Data Lake Object. Uses verified Data 360 Data Model Object endpoints.

# examples

- Run against a target org:
  <%= config.bin %> <%= command.id %> --target-org my-org --file -
- Run with machine-readable output:
  <%= config.bin %> <%= command.id %> --target-org my-org --file - --json

# flags.file.summary

Path to the JSON definition file, or `-` to read it from stdin.

# flags.from-dlo.summary

Generate the Data Model Object definition from this Data Lake Object.

# error.D360_API_ERROR

The Data Model Object request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the definition or resource name.
