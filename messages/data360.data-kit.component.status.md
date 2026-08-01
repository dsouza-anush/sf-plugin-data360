# summary

Get deployment status for a Data 360 data-kit component.

# description

Get the deployment status of one component. Use this command after `data-kit deploy` or `data-kit undeploy`; v67 defines component status rather than a data-kit deployment-job status resource.

# examples

- Check deployment status for a component:
  <%= config.bin %> <%= command.id %> --target-org my-org --name CustomerFoundation --component Customer__dll
- Return the complete component status response as JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name CustomerFoundation --component Customer__dll --json

# flags.name.summary

Developer name of the data kit.

# flags.component.summary

Name of the deployed component.
