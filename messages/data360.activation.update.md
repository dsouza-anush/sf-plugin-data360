# summary

Update an activation.

# description

Replaces an activation definition with PUT.

# examples

- Update by name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Email_Activation --file activation.json
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Email_Activation --file activation.json --json

# flags.name.summary

Activation name or ID.

# flags.file.summary

JSON definition file.
