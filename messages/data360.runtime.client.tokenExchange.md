# error.D360_TOKEN_EXCHANGE_FAILED.0

The token exchange returned an invalid tenant URL.

# error.D360_TOKEN_EXCHANGE_FAILED.0.actions.1

Run sf data360 doctor and verify the External Client App configuration.

# error.D360_TOKEN_EXCHANGE_FAILED.1

The token exchange returned an unapproved tenant URL.

# error.D360_TOKEN_EXCHANGE_FAILED.1.actions.1

Run sf data360 doctor and verify the External Client App configuration.

# error.D360_AUTH_EXPIRED.2

The core org connection does not contain an access token.

# error.D360_AUTH_EXPIRED.2.actions.1

Authenticate again with sf org login web -o <alias>.

# error.D360_TOKEN_EXCHANGE_FAILED.3.actions.1

Check the External Client App and its cdp_* scopes.

# error.D360_TOKEN_EXCHANGE_FAILED.3.actions.2

Run sf data360 doctor for setup guidance.

# error.D360_TOKEN_EXCHANGE_FAILED.4

Salesforce returned HTTP 200 for the Data 360 token exchange but did not return an access token.

# error.D360_TOKEN_EXCHANGE_FAILED.4.actions.1

Verify that the External Client App includes the required cdp_* scopes and is authorized for this user.

# error.D360_TOKEN_EXCHANGE_FAILED.4.actions.2

Authenticate the org with the approved OAuth flow, then run sf data360 doctor and retry.
