# summary

Cancel a Data 360 SQL query.

# description

Cancel a running Query SQL request after explicit confirmation.

# examples

- Cancel the most recently submitted query:
  <%= config.bin %> <%= command.id %> --use-most-recent
- Cancel a specific query in an explicitly selected data space:
  <%= config.bin %> <%= command.id %> --query-id QUERY_ID --target-org my-org --data-space default

# flags.query-id.summary

Opaque Query SQL identifier.

# flags.use-most-recent.summary

Use the most recently cached query.

# error.D360_NOT_FOUND

The query identifier cannot be resolved.

# error.D360_NOT_FOUND.actions

Provide a valid query ID or submit a new query.

# runtime.confirmCancel

Cancel Query SQL job %s?
