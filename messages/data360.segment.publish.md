# summary

Publish a segment.

# description

Starts billable segment publication and optionally waits for completion.

# examples

- Publish and return immediately:
  <%= config.bin %> <%= command.id %> --target-org my-org --name High_Value --no-prompt
- Wait up to five minutes:
  <%= config.bin %> <%= command.id %> --target-org my-org --name High_Value --wait 5 --no-prompt

# flags.name.summary

Segment API name, display name, or ID.

# flags.wait.summary

Minutes to wait for publication.

# flags.no-prompt.summary

Confirm the billable publication without prompting.

# runtime.confirmDestructive

Publish segment %s? This operation can consume Data 360 credits.

# error.D360_JOB_TIMEOUT

Timed out waiting for segment publication.

# error.D360_JOB_TIMEOUT.actions

Run segment get to inspect publish status.

# error.D360_JOB_FAILED

Segment publication failed.

# error.D360_JOB_FAILED.actions

Run segment get to inspect publish status.

# error.D360_JOB_FAILED.1

Segment publish failed with status %s.

# error.D360_JOB_FAILED.1.actions.1

Run sf data360 segment get -n %s.

# error.D360_JOB_TIMEOUT.2

Timed out waiting for segment publish.

# error.D360_JOB_TIMEOUT.2.actions.1

Run sf data360 segment get -n %s.
