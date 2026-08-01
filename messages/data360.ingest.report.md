# summary

Report an ingestion job.

# description

Display the current state, record counts, and timestamps for a bulk ingestion job.

# examples

- Report a specific job:
  <%= config.bin %> <%= command.id %> --target-org my-org --job-id job-id
- Report the most recent cached job:
  <%= config.bin %> <%= command.id %> --use-most-recent

# flags.job-id.summary

Opaque ingestion job identifier.

# flags.use-most-recent.summary

Use the most recently cached ingestion job.

# error.D360_NOT_FOUND

No matching cached ingestion job is available.

# error.D360_NOT_FOUND.actions

Provide `--job-id` and `--target-org`, or submit a bulk job first.
