# summary

Delete a Data 360 data kit.

# description

Delete a data kit by developer name. This operation deletes the kit definition; verify component deployment and package dependencies before continuing.

# examples

- Review deletion interactively:
  <%= config.bin %> <%= command.id %> --target-org my-org --name CustomerFoundation
- Delete a data kit in a noninteractive script:
  <%= config.bin %> <%= command.id %> --target-org my-org --name CustomerFoundation --no-prompt

# flags.name.summary

Developer name of the data kit to delete.

# flags.no-prompt.summary

Skip the data-kit deletion confirmation.

# prompt.delete

Delete data kit %s?

# error.D360_CONFIRMATION_REQUIRED

Data-kit deletion requires explicit confirmation.

# error.D360_CONFIRMATION_REQUIRED.actions

Verify the data-kit developer name, then rerun with `--no-prompt` in a noninteractive context.
