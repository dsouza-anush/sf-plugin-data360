# summary

Update a segment.

# description

Updates a segment using its canonical API name.

# examples

- Update by display name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name "High Value" --file segment.json
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name High_Value --file segment.json --json

# flags.name.summary

Segment API name, display name, or ID.

# flags.file.summary

JSON definition file, or - for stdin.
