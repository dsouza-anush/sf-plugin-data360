# summary

Delete records through the streaming Ingestion API.

# description

Delete record IDs after an interactive confirmation, or use --no-prompt explicitly in scripts.

# examples

- Delete two IDs interactively:
  <%= config.bin %> <%= command.id %> --target-org my-org --source-name connector --object-name Contact --ids 1 --ids 2
- Delete IDs from a file in automation:
  <%= config.bin %> <%= command.id %> --target-org my-org --source-name connector --object-name Contact --file ids.txt --no-prompt

# flags.source-name.summary

Ingestion API connector name.

# flags.object-name.summary

Object configured for the ingestion connector.

# flags.ids.summary

Record ID to delete; repeat for multiple IDs.

# flags.file.summary

JSON, comma-separated, or newline-separated ID file, or `-` for stdin.

# flags.no-prompt.summary

Confirm deletion explicitly without an interactive prompt.

# error.D360_INVALID_DEFINITION

Delete IDs must contain 1 to 200 non-empty strings within the streaming request limit.

# error.D360_INVALID_DEFINITION.actions

Use bulk ingestion with `--operation delete` for more than 200 records.

# error.D360_CONFIRMATION_REQUIRED

Streaming delete requires explicit confirmation.

# error.D360_CONFIRMATION_REQUIRED.actions

Re-run with `--no-prompt` in scripts and JSON mode.

# prompt.delete

Delete %s records from %s?

# error.D360_INVALID_DEFINITION.0.actions.1

Provide 1 to 200 non-empty string IDs.

# error.D360_INVALID_DEFINITION.0.actions.2

Use sf data360 ingest bulk --operation delete for more than 200 records.
