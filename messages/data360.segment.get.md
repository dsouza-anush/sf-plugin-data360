# summary

Get a segment.

# description

Gets a segment and optionally requests its current count.

# examples

- Get by API name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name High_Value
- Include the count:
  <%= config.bin %> <%= command.id %> --target-org my-org --name High_Value --with-count --json

# flags.name.summary

Segment API name, display name, or ID.

# flags.with-count.summary

Include the current segment count.
