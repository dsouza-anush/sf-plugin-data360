# summary

Run a calculated insight.

# description

Starts a billable calculated insight run after a credit warning and confirmation.

# examples

- Run by API name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Revenue__cio
- Return JSON from approved automation:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Revenue__cio --no-prompt --json

# flags.name.summary

Calculated insight API name or display name.

# flags.no-prompt.summary

Confirm the billable calculated insight run without prompting.

# runtime.confirmDestructive

Run calculated insight %s now? This operation can consume Data 360 credits.

# error.D360_CONFIRMATION_REQUIRED

Confirmation is required for this billable operation.

# error.D360_CONFIRMATION_REQUIRED.actions

Re-run with `--no-prompt`.

# error.D360_INVALID_DEFINITION

The resolved API name does not end with __cio.

# error.D360_INVALID_DEFINITION.actions

Use an API name ending in __cio.

# error.D360_INVALID_DEFINITION.0

Calculated insight API names must end with "__cio".

# error.D360_INVALID_DEFINITION.0.actions.1

Use an API name ending in __cio.
