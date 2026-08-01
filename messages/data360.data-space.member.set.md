# summary

Add or update data-space DLO members.

# description

Add data lake objects (DLOs) to a data space or update their row-level filters. The input file contains a top-level `members` array with a `memberName` and filter object for each DLO.

# examples

- Add or update members from a reviewed file:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --file data-space-members.json
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --file - --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# flags.file.summary

Path to the JSON definition file, or `-` to read it from stdin.

# error.D360_API_ERROR

Data-space request failed.

# error.D360_API_ERROR.actions

Re-run with --json.

# error.D360_INVALID_DEFINITION.0

Member set requires a non-empty members array. Each member requires a memberName and filter object.

# error.D360_INVALID_DEFINITION.0.actions.1

Provide {"members":[{"memberName":"Example__dll","filter":{"conjunctiveOperator":"NoneOperator","conditions":{"conditions":[]}}}]}.

# runtime.confirmMembers

Replace or update %s data-space member definition(s) in %s?
