# summary

Resume waiting for a Data 360 SQL query.

# description

Restore a cached query context and wait for the query to finish before returning rows.

# examples

- Resume the most recently submitted query:
  <%= config.bin %> <%= command.id %> --use-most-recent
- Resume a specific query and write CSV output:
  <%= config.bin %> <%= command.id %> --query-id QUERY_ID --target-org my-org --result-format csv --output-file rows.csv

# flags.query-id.summary

Opaque Query SQL identifier.

# flags.use-most-recent.summary

Use the most recently cached query.

# flags.wait.summary

Minutes to wait for completion.

# error.D360_JOB_TIMEOUT

The query is still running when the wait period expires.

# error.D360_JOB_TIMEOUT.actions

Run the displayed resume command to continue waiting.
