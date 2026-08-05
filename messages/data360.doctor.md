# summary

Diagnose Data 360 org and plugin configuration.

# description

Check org authentication, API compatibility, Data 360 provisioning, data spaces, and Direct API readiness.

# examples

- Run diagnostics for the configured target org:
  <%= config.bin %> <%= command.id %>
- Produce structured diagnostics for support automation:
  <%= config.bin %> <%= command.id %> --target-org my-org --json

# flags.data-space.summary

Data space whose configuration should be validated.

# error.D360_NOT_PROVISIONED

Data 360 provisioning checks failed.

# error.D360_NOT_PROVISIONED.actions

Confirm Data 360 is provisioned and the user has access.

# error.D360_TOKEN_EXCHANGE_FAILED

The External Client App could not exchange the core token for a Direct API token.

# error.D360_TOKEN_EXCHANGE_FAILED.actions

Configure the required `cdp_*` scopes, authorize the org again, and rerun doctor.

# error.D360_SCOPE_MISSING

One or more required Direct API scopes are missing.

# error.D360_SCOPE_MISSING.actions

Add every scope listed by doctor to the External Client App and authorize the org again.

# error.RUNTIME_1.1

Direct token exchange did not complete.
