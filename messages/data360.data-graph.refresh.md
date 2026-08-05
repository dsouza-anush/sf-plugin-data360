# summary

Refresh a data graph.

# description

Starts a verified data graph rebuild.

# examples

- Refresh by name:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Customer_Graph
- Return JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Customer_Graph --json

# flags.name.summary

Data graph name.

# error.D360_JOB_TIMEOUT

The graph refresh request timed out and its server-side outcome is unknown.

# error.D360_JOB_TIMEOUT.actions

Check the data graph status before retrying.
