# summary

Get a verified Data 360 retriever.

# description

Resolve a retriever by name or label and return its recorded detail shape.

# examples

- Get a retriever by API name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name SalesforceHelpContentRetriever
- Get a retriever as JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name SalesforceHelpContentRetriever --json

# flags.name.summary

Retriever API name or label.

# error.D360_NOT_FOUND

The retriever was not found.

# error.D360_NOT_FOUND.actions

Run retriever list and use an available name.
