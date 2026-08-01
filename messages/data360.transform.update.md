# summary

Update data transforms.

# description

Verified transform operation.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --file -
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --file - --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# flags.file.summary

Path to the JSON definition file, or `-` to read it from stdin.

# error.D360_API_ERROR

Transform request failed.

# error.D360_API_ERROR.actions

Re-run with --json.
