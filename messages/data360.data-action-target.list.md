# summary

List Data 360 data action targets.

# description

List data action targets available in the target org.

# examples

- List data action targets:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Return all data action targets as JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --all --json

# flags.all.summary

Fetch all available data action targets.

# flags.limit.summary

Maximum number of data action targets to return.

# flags.result-format.summary

Format data action target rows as human, CSV, or JSON output.
