# summary

Resume waiting for an ingestion job.

# description

Reattach to a closed bulk ingestion job and wait for its terminal state.

# examples

- Resume a specific job:
  <%= config.bin %> <%= command.id %> --target-org my-org --job-id job-id --wait 10
- Resume the most recent cached job:
  <%= config.bin %> <%= command.id %> --use-most-recent

# flags.job-id.summary

Opaque ingestion job identifier.

# flags.use-most-recent.summary

Use the most recently cached ingestion job.

# flags.wait.summary

Minutes to wait for a terminal state.

# error.D360_NOT_FOUND

No matching cached ingestion job is available.

# error.D360_NOT_FOUND.actions

Provide `--job-id` and `--target-org`, or submit a bulk job first.

# error.D360_JOB_TIMEOUT

The ingestion job is still processing.

# error.D360_JOB_TIMEOUT.actions

Run `sf data360 ingest resume -r`.

# error.D360_JOB_FAILED

The ingestion job reached a failed or aborted state.

# error.D360_JOB_FAILED.actions

Run `sf data360 ingest report --job-id <job-id> --json`.
