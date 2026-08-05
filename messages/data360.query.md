# summary

Run SQL against Data 360.

# description

Submit SQL to the Data 360 Query SQL API, or start the interactive REPL when no query source is provided in a TTY.

# examples

- Run an inline query and display a table:
  <%= config.bin %> <%= command.id %> --query 'SELECT * FROM "ssot__Individual__dlm" LIMIT 10' --target-org my-org
- Pipe SQL and write RFC-4180 CSV:
  <%= config.bin %> <%= command.id %> --file - --result-format csv --output-file rows.csv --target-org my-org < query.sql
- Submit asynchronously and resume later:
  <%= config.bin %> <%= command.id %> --query 'SELECT COUNT(*) FROM "ssot__Individual__dlm"' --async --target-org my-org
- Run parameterized SQL with support-visible workload metadata and execution settings:
  <%= config.bin %> <%= command.id %> --query 'SELECT * FROM "FlightSeat__dll" WHERE "boardingstatus__c" = :status' --query-options-file query-options.json --workload-name nightly-seat-audit --target-org my-org
- Start the interactive SQL REPL with persistent history:
  <%= config.bin %> <%= command.id %> --target-org my-org

# flags.query.summary

SQL text to execute.

# flags.file.summary

SQL file path, or `-` to read from stdin.

# flags.data-space.summary

Data space to query.

# flags.row-limit.summary

Maximum rows to request.

# flags.wait.summary

Minutes to wait for completion.

# flags.async.summary

Return immediately after submission.

# error.D360_QUERY_SYNTAX

The Data 360 SQL query is invalid.

# error.D360_QUERY_SYNTAX.actions

Correct the SQL syntax and run the query again.

# error.D360_API_ERROR

The REPL command, history file, or query output configuration is invalid.

# error.D360_API_ERROR.actions

Use `\q`, `\dt`, `\d <entity>`, or `\f human|csv|json`; ensure the history path is a regular user-owned file.

# error.D360_API_ERROR.0

Unable to resolve the org API version.

# error.D360_API_ERROR.0.actions.1

Re-run with --api-version or run sf data360 doctor.

# error.D360_API_ERROR.1

Unable to resolve the wait duration.

# error.D360_API_ERROR.1.actions.1

Re-run with --wait or --async.

# error.D360_AUTH_EXPIRED.2

Unable to resolve the target org username.

# error.D360_AUTH_EXPIRED.2.actions.1

Authenticate again with sf org login web --alias <alias> --instance-url <my-domain-url>.

# runtime.status.3

sf data360 query resume -r

# runtime.status.4

sf data360 query results -i "%s"

# runtime.confirmBillable

Run this Data 360 SQL query? Query execution can consume Data 360 credits.

# error.D360_API_ERROR.5

Unknown table type: %s

# error.D360_API_ERROR.5.actions.1

Use dlo, dmo, or ci.
