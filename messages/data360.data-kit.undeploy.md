# summary

Undeploy components from a Data 360 data kit.

# description

Submit an ordered JSON `components` array of component `type` and `name` values with `asyncMode=true`. This destructive operation can return a job ID but has no deployment-job status endpoint; inspect each submitted component with `data-kit component status`.

# examples

- Review component undeployment interactively:
  <%= config.bin %> <%= command.id %> --target-org my-org --name CustomerFoundation --file examples/data-kit/undeploy.json
- Undeploy components in a noninteractive script:
  <%= config.bin %> <%= command.id %> --target-org my-org --name CustomerFoundation --file examples/data-kit/undeploy.json --data-space loyalty --no-prompt

# flags.name.summary

Developer name of the data kit containing the components.

# flags.file.summary

Path to a JSON object containing the ordered component undeployment `components` array, or `-` to read stdin.

# flags.data-space.summary

Data space from which the selected components are undeployed.

# flags.no-prompt.summary

Skip the component-undeployment confirmation.

# prompt.undeploy

Undeploy the selected components from data kit %s?

# runtime.continuation

Continue with: sf data360 data-kit component status --name "%s" --component <component-name> --target-org "%s"

# error.D360_CONFIRMATION_REQUIRED

Data-kit component undeployment requires explicit confirmation.

# error.D360_CONFIRMATION_REQUIRED.actions

Review the component order and target data space, then rerun with `--no-prompt` in a noninteractive context.
