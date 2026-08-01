# summary

Fetch cached rows for a Data 360 SQL query.

# description

Read Query SQL results retained by Data 360 without rerunning the query or consuming query credits again.

# examples

- Fetch rows for the most recently submitted query:
  <%= config.bin %> <%= command.id %> --use-most-recent
- Stream every result page to a CSV file:
  <%= config.bin %> <%= command.id %> --query-id QUERY_ID --target-org my-org --all --result-format csv --output-file rows.csv

# flags.query-id.summary

Opaque Query SQL identifier.

# flags.use-most-recent.summary

Use the most recently cached query.

# flags.omit-schema.summary

Ask the API to omit metadata for JSON row output.

# error.D360_NOT_FOUND

The cached query or its retained results no longer exist.

# error.D360_NOT_FOUND.actions

Run the query again to create a new result cache.

# flags.offset.summary

Zero-based row offset.

# flags.row-limit.summary

Rows to request per page.

# error.D360_API_ERROR.0

--omit-schema requires JSON row output because human and CSV output need column metadata.

# error.D360_API_ERROR.0.actions.1

Use --result-format json or the global --json flag with --omit-schema.
