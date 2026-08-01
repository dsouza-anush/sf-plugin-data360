# summary

Deactivate a segment.

# description

Deactivates a segment after confirmation using its canonical API name.

# examples

- Deactivate interactively:
  <%= config.bin %> <%= command.id %> --target-org my-org --name High_Value
- Deactivate in automation:
  <%= config.bin %> <%= command.id %> --target-org my-org --name High_Value --no-prompt

# flags.name.summary

Segment API name, display name, or ID.

# flags.no-prompt.summary

Proceed without prompting.

# error.D360_CONFIRMATION_REQUIRED

Confirmation is required.

# error.D360_CONFIRMATION_REQUIRED.actions

Re-run with --no-prompt.

# runtime.confirmDestructive.0

Deactivate segment %s?
