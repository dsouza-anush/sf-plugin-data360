# summary

Delete an activation.

# description

Deletes an activation after confirmation.

# examples

- Delete interactively:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Email_Activation
- Delete in automation:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Email_Activation --no-prompt

# flags.name.summary

Activation name or ID.

# flags.no-prompt.summary

Proceed without prompting.
