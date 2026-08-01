# summary

Get a Data 360 metadata entity.

# description

Display an entity's fields, keys, indexes, and relationships.

# examples

- Describe a Data Model Object by API name:
  <%= config.bin %> <%= command.id %> --name ssot__Individual__dlm --target-org my-org
- Return the complete entity contract as JSON:
  <%= config.bin %> <%= command.id %> --name ssot__Account__dlm --target-org my-org --json

# flags.name.summary

Entity API name or display name.

# error.D360_NAME_NOT_FOUND

No matching metadata entity was found.

# error.D360_NAME_NOT_FOUND.actions

Run `sf data360 metadata list` to view available entities.

# runtime.status.0

%s (%s)
