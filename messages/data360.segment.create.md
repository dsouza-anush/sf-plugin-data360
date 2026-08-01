# summary

Create a segment.

# description

Creates a segment from a JSON definition.

# examples

- Create from a file:
  <%= config.bin %> <%= command.id %> --target-org my-org --file segment.json
- Read from stdin:
  <%= config.bin %> <%= command.id %> --target-org my-org --file - < segment.json

# flags.file.summary

JSON definition file, or - for stdin.
