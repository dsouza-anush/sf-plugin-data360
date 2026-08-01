# summary

List components available to Data 360 data kits.

# description

List components from the data-kit available-components endpoint for a required data-kit developer name. Filter by supported component type and page with the API's 1-through-200 limit and zero-based offset.

# examples

- List Data Lake Objects available to a specific data kit:
  <%= config.bin %> <%= command.id %> --target-org my-org --component-type DataLakeObject --data-kit CustomerFoundation --offset 0

- List the next page of data streams available to the same data kit:
  <%= config.bin %> <%= command.id %> --target-org my-org --component-type DataStream --data-kit CustomerFoundation --limit 50 --offset 50

# flags.component-type.summary

Required supported component type used to filter available components.

# flags.data-kit.summary

Required data-kit developer name whose available components are listed.

# flags.limit.summary

Maximum components to return, from 1 through 200.

# flags.offset.summary

Number of components to skip before returning results.
