# summary

Get a Data 360 connector type and configuration schema.

# description

Get one verified connector type, including its connector configuration schema.

# examples

- Get a connector by type:
  <%= config.bin %> <%= command.id %> --name MarketingCloud --target-org my-org
- Get a connector using a case-insensitive exact label:
  <%= config.bin %> <%= command.id %> --name "Marketing Cloud" --json --target-org my-org

# flags.name.summary

Connector type or exact label.

# error.D360_API_ERROR

The connector API request failed.

# error.D360_API_ERROR.actions

Re-run with --json and verify the connector type.
