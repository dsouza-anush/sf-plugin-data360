# summary

Run a data transform.

# description

Starts a billable Data Services transform after a credit warning and confirmation.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --no-prompt --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# flags.no-prompt.summary

Confirm the billable transform run without prompting.

# runtime.confirmDestructive

Run transform %s now? This operation can consume Data 360 credits.

# error.D360_API_ERROR

Transform request failed.

# error.D360_API_ERROR.actions

Re-run with --json.

# error.D360_CONFIRMATION_REQUIRED

Confirmation is required for this billable operation.

# error.D360_CONFIRMATION_REQUIRED.actions

Re-run with `--no-prompt`.

# error.D360_JOB_TIMEOUT

The transform run request timed out and its server-side outcome is unknown.

# error.D360_JOB_TIMEOUT.actions

Check the transform status before retrying.

# runtime.continuation

Continue with: sf data360 transform report --name "%s" --target-org "%s"
