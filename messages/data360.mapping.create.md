# summary

Create a mapping manually or automatically.

# description

Create a mapping manually or automatically. Uses verified mapping endpoints.

# examples

- Run against an org:
  <%= config.bin %> <%= command.id %> --target-org my-org --file -
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --file - --json

# flags.file.summary

Path to the JSON definition file, or `-` to read it from stdin.

# flags.auto.summary

Generate field mappings automatically.

# flags.dlo.summary

Source Data Lake Object developer name.

# flags.dmo.summary

Target Data Model Object developer name.

# flags.dry-run.summary

Preview the generated mapping without creating it.

# error.D360_API_ERROR

Mapping request failed.

# error.D360_API_ERROR.actions

Re-run with --json and correct the mapping.

# error.D360_INVALID_DEFINITION.0

--auto requires both --dlo and --dmo.

# error.D360_INVALID_DEFINITION.0.actions.1

Pass --dlo <name> --dmo <name>.
