# summary

Run a data stream.

# description

Run a data stream. Uses verified data-stream endpoints.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# error.D360_API_ERROR

Data stream request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the stream.

# error.D360_JOB_TIMEOUT

The stream run request timed out and its server-side outcome is unknown.

# error.D360_JOB_TIMEOUT.actions

Check the stream status before retrying.

# runtime.continuation

Continue with: sf data360 data-stream get --name "%s" --target-org "%s"

# runtime.confirmBillable

Run external data stream %s now? This operation can consume Data 360 credits.
