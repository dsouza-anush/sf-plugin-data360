# summary

List dependencies for a Data 360 data-kit component.

# description

List dependencies for one deployed component. Specify the component's exact type so the Connect API can resolve the correct dependency graph.

# examples

- List dependencies for a deployed Data Lake Object:
  <%= config.bin %> <%= command.id %> --target-org my-org --name CustomerFoundation --component Customer__dll --component-type DataLakeObject
- Inspect dependencies in another data space:
  <%= config.bin %> <%= command.id %> --target-org my-org --name CustomerFoundation --component CustomerGraph --component-type DataGraph --data-space loyalty

# flags.name.summary

Developer name of the data kit.

# flags.component.summary

Name of the deployed component.

# flags.component-type.summary

Exact type of the deployed component.

# flags.data-space.summary

Data space containing the deployed component.
