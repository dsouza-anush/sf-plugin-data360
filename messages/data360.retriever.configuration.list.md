# summary

List configurations for a verified Data 360 retriever.

# description

Resolve a retriever and list its live-verified configuration records.

# examples

- List configurations by retriever name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name SalesforceHelpContentRetriever
- Return every configuration as JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name SalesforceHelpContentRetriever --all --json

# flags.name.summary

Retriever API name or label.

# flags.all.summary

Fetch all available retriever configurations.

# flags.limit.summary

Maximum number of retriever configurations to return.

# error.D360_NOT_FOUND

The retriever was not found.

# error.D360_NOT_FOUND.actions

Run retriever list and use an available name.
