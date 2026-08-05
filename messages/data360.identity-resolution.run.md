# summary

Run an identity resolution ruleset now.

# description

Starts the costliest Data 360 operation after a credit warning and confirmation.

# examples

- Review the warning and confirm:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Main
- Run from automation:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Main --no-prompt

# flags.name.summary

Identity resolution ruleset name, label, or ID.

# flags.no-prompt.summary

Proceed without prompting.

# error.D360_CONFIRMATION_REQUIRED

Confirmation is required for this expensive operation.

# error.D360_CONFIRMATION_REQUIRED.actions

Re-run with --no-prompt.

# runtime.continuation

Continue with: sf data360 identity-resolution get --name "%s" --target-org "%s"

# runtime.confirmDestructive.1

Run identity-resolution %s now? This is the costliest Data 360 operation.
