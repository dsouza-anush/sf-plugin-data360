# summary

Delete an identity resolution ruleset.

# description

Deletes a ruleset after confirmation.

# examples

- Delete interactively:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Main
- Delete in automation:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Main --no-prompt

# flags.name.summary

Identity resolution ruleset name, label, or ID.

# flags.no-prompt.summary

Proceed without prompting.

# error.D360_CONFIRMATION_REQUIRED

Confirmation is required.

# error.D360_CONFIRMATION_REQUIRED.actions

Re-run with --no-prompt.
