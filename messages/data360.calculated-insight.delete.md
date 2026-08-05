# summary

Delete a calculated insight.

# description

Deletes a calculated insight after confirmation.

# examples

- Delete interactively:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Revenue__cio
- Delete in automation:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Revenue__cio --no-prompt

# flags.name.summary

Calculated insight API name or display name.

# flags.no-prompt.summary

Proceed without prompting.

# error.D360_INVALID_DEFINITION

The resolved API name does not end with __cio.

# error.D360_INVALID_DEFINITION.actions

Use an API name ending in __cio.

# error.D360_CONFIRMATION_REQUIRED

Confirmation is required.

# error.D360_CONFIRMATION_REQUIRED.actions

Re-run with --no-prompt.
