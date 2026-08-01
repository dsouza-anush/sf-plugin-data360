# summary

Stream records into Data 360.

# description

Read JSON array or NDJSON object records, confirm the billable operation, split them below the 200 KB API cap, and submit each batch.

# examples

- Ingest records from an NDJSON file:
  <%= config.bin %> <%= command.id %> --target-org my-org --source-name connector --object-name Contact --file contacts.ndjson
- Ingest a JSON array from stdin:
  <%= config.bin %> <%= command.id %> --target-org my-org --source-name connector --object-name Contact < contacts.json

# flags.source-name.summary

Ingestion API connector name.

# flags.object-name.summary

Object configured for the ingestion connector.

# flags.file.summary

JSON array or NDJSON file, or `-` for stdin.

# error.D360_INVALID_DEFINITION

The streaming input is malformed, non-object, or too large.

# error.D360_INVALID_DEFINITION.actions

Provide object records whose serialized request body is smaller than 200,000 bytes.

# notice.credit

Note: this run bills ingestion credits (rows-processed based). Docs: https://sfdc.co/data360-credits

# notice.consistency

Accepted for ~3-minute micro-batching; allow ~30 seconds for read consistency.

# prompt.ingest

Stream records into %s? This operation consumes ingestion credits.
