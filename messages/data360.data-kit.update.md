# summary

Synchronize components in a Data 360 data kit.

# description

Replace a data kit's component set with the `components` array in a JSON definition. This PATCH operation is destructive: components omitted from the definition are removed from the kit.

# examples

- Review the destructive sync interactively:
  <%= config.bin %> <%= command.id %> --target-org my-org --name CustomerFoundation --file examples/data-kit/components.json
- Synchronize components in a noninteractive script:
  <%= config.bin %> <%= command.id %> --target-org my-org --name CustomerFoundation --file examples/data-kit/components.json --no-prompt

# flags.name.summary

Developer name of the data kit to synchronize.

# flags.file.summary

Path to the replacement component-set JSON definition, or `-` to read stdin.

# flags.no-prompt.summary

Skip the destructive component-sync confirmation.

# prompt.update

Replace the complete component set of data kit %s and remove omitted components?

# error.D360_CONFIRMATION_REQUIRED

Data-kit component synchronization requires explicit confirmation.

# error.D360_CONFIRMATION_REQUIRED.actions

Review the complete replacement definition, then rerun with `--no-prompt` in a noninteractive context.
