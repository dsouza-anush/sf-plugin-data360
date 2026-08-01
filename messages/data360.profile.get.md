# summary

Get Data 360 profile data.

# description

Reads verified profile list, record, and calculated insight variants.

# examples

- Search profiles:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Individual__dlm --search-key email=a@example.com --fields Id,Name
- Read calculated insights for a record:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Individual__dlm --id record-1 --insight Revenue__cio

# flags.name.summary

Profile data model name.

# flags.id.summary

Profile record ID.

# flags.search-key.summary

Search key as key=value.

# flags.fields.summary

Comma-separated fields.

# flags.insight.summary

Calculated insight API name.
