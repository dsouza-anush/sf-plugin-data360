# summary

Describe Document AI capabilities.

# description

Display the content types and models available to Data 360 Document AI.

# examples

- Describe Document AI capabilities:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Return the capability document as JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --json

# runtime.version

Document AI global configuration version: %s

# error.D360_NOT_PROVISIONED

Document AI is not provisioned in the target org.

# error.D360_NOT_PROVISIONED.actions

Confirm the Document AI license and run sf data360 doctor.
