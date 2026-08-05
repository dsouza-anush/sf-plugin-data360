# summary

Delete a data stream while keeping its DLO by default.

# description

Delete a data stream while keeping its DLO by default. Uses verified data-stream endpoints.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --no-prompt
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --no-prompt --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# flags.delete-dlo.summary

Also delete the Data Lake Object created for the stream.

# flags.no-prompt.summary

Skip the confirmation prompt.

# error.D360_API_ERROR

Data stream request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the stream.

# runtime.confirmDestructive.0

Delete data stream %s?

# runtime.confirmDestructive.1

Also permanently delete the underlying Data Lake Object?
