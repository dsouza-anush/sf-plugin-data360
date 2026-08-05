# summary

Open Data 360 in a browser.

# description

Create a single-use frontdoor URL for a supported Data 360 page and optionally launch it privately.

# examples

- Open the Data 360 home page:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Print the segments page URL without launching a browser:
  <%= config.bin %> <%= command.id %> --target-org my-org --path segments --url-only

# flags.path.summary

Data 360 page to open.

# flags.url-only.summary

Print the credential-bearing URL without launching a browser. Treat the output as a secret.

# error.D360_CONFIRMATION_REQUIRED

JSON output can expose a credential-bearing frontdoor URL.

# error.D360_CONFIRMATION_REQUIRED.actions

Add `--url-only` only when you intend to capture the URL, and protect the output as a secret.

# error.D360_AUTH_EXPIRED

The target org session is no longer valid.

# error.D360_AUTH_EXPIRED.actions

Authenticate again with `sf org login web --alias <alias> --instance-url <my-domain-url>`.

# flags.private.summary

Open in a private browser window.
