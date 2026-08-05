# summary

Look up a Data 360 universal ID.

# description

Uses all four required path parameters without dropping or merging values.

# examples

- Look up a source record:
  <%= config.bin %> <%= command.id %> --target-org my-org --entity Individual --data-source crm --data-source-object Contact --record 003xx
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --entity Individual --data-source crm --data-source-object Contact --record 003xx --json

# flags.entity.summary

Entity name.

# flags.data-source.summary

Data source ID.

# flags.data-source-object.summary

Data source object ID.

# flags.record.summary

Source record ID.
