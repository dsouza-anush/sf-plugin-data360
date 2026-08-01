# summary

Get activation result data.

# description

Reads the verified activation data endpoint.

# examples

- Get results by name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Email_Activation
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Email_Activation --json

# flags.name.summary

Activation name or ID.
