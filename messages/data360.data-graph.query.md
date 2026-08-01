# summary

Query data graph data.

# description

Reads by record ID or lookup keys with optional live mode and JSON file output.

# examples

- Query by ID:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Customer_Graph --id record-1 --live
- Query by lookup key into a file:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Customer_Graph --lookup-keys email=a@example.com --output-file result.json

# flags.name.summary

Data graph name or entity name.

# flags.id.summary

Record ID.

# flags.lookup-keys.summary

Comma-separated lookup keys as key=value.

# flags.live.summary

Read live data.

# flags.output-file.summary

Write pretty JSON to a file.
