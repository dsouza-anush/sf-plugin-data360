# summary

Validate ingestion records without writing data.

# description

Submit sample JSON or NDJSON records to the synchronous schema-validation endpoint.

# examples

- Validate a sample file:
  <%= config.bin %> <%= command.id %> --target-org my-org --source-name connector --object-name Contact --file sample.json
- Validate piped NDJSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --source-name connector --object-name Contact < sample.ndjson

# flags.source-name.summary

Ingestion API connector name.

# flags.object-name.summary

Object configured for the ingestion connector.

# flags.file.summary

Sample JSON array or NDJSON file, or `-` for stdin.

# error.D360_INVALID_DEFINITION

The sample does not match the ingestion object schema.

# error.D360_INVALID_DEFINITION.actions

Correct every field in `validationReport` and validate the sample again.
