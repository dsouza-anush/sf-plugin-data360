# summary

Deploy components from a Data 360 data kit.

# description

Submit a JSON `components` array with the required `asyncMode=true` query parameter. Each component's `config` object is specific to its component type. The Connect API can return a job ID but defines no deployment-job status endpoint; inspect each submitted component with `data-kit component status`.

# examples

- Deploy selected components to the default data space:
  <%= config.bin %> <%= command.id %> --target-org my-org --name CustomerFoundation --file examples/data-kit/deploy.json
- Deploy selected components to another data space:
  <%= config.bin %> <%= command.id %> --target-org my-org --name CustomerFoundation --file examples/data-kit/deploy.json --data-space loyalty

# flags.name.summary

Developer name of the data kit containing the components.

# flags.file.summary

Path to a JSON object containing the component deployment `components` array, or `-` to read stdin.

# flags.data-space.summary

Data space to which the selected components are deployed.

# runtime.continuation

Continue with: sf data360 data-kit component status --name "%s" --component <component-name> --target-org "%s"

# error.D360_INVALID_DEFINITION

Invalid data-kit deployment definition: %s.

# error.D360_INVALID_DEFINITION.actions

Use the component-specific `config` documented at https://developer.salesforce.com/docs/data/connectapi/guide/deploy-data-kit-payloads.html.
