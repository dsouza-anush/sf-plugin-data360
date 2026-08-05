# summary

Delete a segment.

# description

Deletes a segment after confirmation using its API name.

# examples

- Delete interactively:
  <%= config.bin %> <%= command.id %> --target-org my-org --name High_Value
- Delete in automation:
  <%= config.bin %> <%= command.id %> --target-org my-org --name High_Value --no-prompt

# flags.name.summary

Segment API name, display name, or ID.

# flags.no-prompt.summary

Proceed without prompting.

# error.D360_CONFIRMATION_REQUIRED

Confirmation is required.

# error.D360_CONFIRMATION_REQUIRED.actions

Re-run with --no-prompt.
