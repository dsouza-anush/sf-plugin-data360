# summary

Abort an ingestion job.

# description

Abort a non-terminal bulk ingestion job after confirmation. Terminal jobs are returned unchanged.

# examples

- Abort a specific job interactively:
  <%= config.bin %> <%= command.id %> --target-org my-org --job-id job-id
- Abort the most recent cached job in automation:
  <%= config.bin %> <%= command.id %> --use-most-recent --no-prompt

# flags.job-id.summary

Opaque ingestion job identifier.

# flags.use-most-recent.summary

Use the most recently cached ingestion job.

# flags.no-prompt.summary

Confirm abort explicitly without an interactive prompt.

# error.D360_NOT_FOUND

No matching cached ingestion job is available.

# error.D360_NOT_FOUND.actions

Provide `--job-id` and `--target-org`, or submit a bulk job first.

# error.D360_CONFIRMATION_REQUIRED

Job cancellation requires explicit confirmation.

# error.D360_CONFIRMATION_REQUIRED.actions

Re-run with `--no-prompt` in scripts and JSON mode.

# prompt.cancel

Abort ingestion job %s?
