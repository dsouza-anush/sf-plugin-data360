# summary

Bulk ingest CSV files into Data 360.

# description

Confirm the billable upsert or delete, create a bulk job, upload CSV batches below 150 MB, close it, and optionally wait.

# examples

- Upload and wait for completion:
  <%= config.bin %> <%= command.id %> --target-org my-org --source-name connector --object-name Contact --file contacts.csv --wait 10
- Upload multiple delete files asynchronously:
  <%= config.bin %> <%= command.id %> --target-org my-org --source-name connector --object-name Contact --file a.csv --file b.csv --operation delete --async

# flags.source-name.summary

Ingestion API connector name.

# flags.object-name.summary

Object configured for the ingestion connector.

# flags.file.summary

CSV input file; repeat for multiple files.

# flags.operation.summary

Bulk operation: `upsert` or `delete`.

# flags.wait.summary

Minutes to wait after UploadComplete.

# flags.async.summary

Return after the job reaches UploadComplete.

# flags.no-prompt.summary

Confirm a bulk delete explicitly without an interactive prompt.

# error.D360_INVALID_DEFINITION

A CSV record or batch violates an ingestion API limit.

# error.D360_INVALID_DEFINITION.actions

Correct or split the CSV input and run the command again.

# error.D360_CONFIRMATION_REQUIRED

Bulk delete requires explicit confirmation.

# error.D360_CONFIRMATION_REQUIRED.actions

Re-run with `--no-prompt` in scripts and JSON mode.

# error.D360_JOB_TIMEOUT

The closed ingestion job is still processing.

# error.D360_JOB_TIMEOUT.actions

Run `sf data360 ingest resume -r`.

# error.D360_JOB_FAILED

The ingestion job reached a failed or aborted state.

# error.D360_JOB_FAILED.actions

Run `sf data360 ingest report --job-id <job-id> --json`.

# prompt.delete

Bulk delete records from %s using %s file(s)?

# prompt.upsert

Bulk upsert records into %s using %s file(s)? This operation consumes ingestion credits.

# notice.credit

Note: this run bills ingestion credits (rows-processed based). Docs: https://sfdc.co/data360-credits

# hint.resume

sf data360 ingest resume --use-most-recent

# progress.title

Data 360 bulk ingest

# progress.stages

- Create job
- Upload
- Close
- Processing
- Done

# error.D360_INVALID_DEFINITION.3

A bulk ingestion job supports at most 100 uploaded batches.

# error.D360_INVALID_DEFINITION.3.actions.1

Reduce the number or size of input files, then run the command again.

# error.D360_API_ERROR.4

Bulk ingestion job %s was interrupted.

# error.D360_API_ERROR.4.actions.1

Run sf data360 ingest report --job-id "%s" --target-org "%s" to inspect the aborted job.
