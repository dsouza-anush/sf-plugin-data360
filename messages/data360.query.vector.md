# summary

Run vector search through Data 360 SQL.

# description

Builds vector_search SQL and executes the standard cached query lifecycle through the Connect
`query-sql` endpoint, which accepts Data 360 SQL. Salesforce's published Data 360 SQL reference does
not currently document this generated vector_search form. Treat the command as beta and validate its
SQL against a non-production target org before relying on it; the generated dialect has not completed
live verification.

# examples

- Search an index:
  <%= config.bin %> <%= command.id %> --target-org my-org --index Knowledge --text "reset password" --top-k 5
- Select chunk fields and write CSV:
  <%= config.bin %> <%= command.id %> --target-org my-org --index Knowledge --text "reset password" --select Title,Body --result-format csv --output-file matches.csv

# flags.index.summary

Search index base or full index table name.

# flags.text.summary

Natural language search text.

# flags.top-k.summary

Maximum matches.

# flags.filter.summary

Search prefilter expression.

# flags.select.summary

Comma-separated chunk fields to select.
