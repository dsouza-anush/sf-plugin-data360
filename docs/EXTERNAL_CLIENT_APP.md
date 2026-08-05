# Configure Direct API authentication

Most commands, including the typed `query` and `profile` families, use Connect REST API with the Salesforce session created by `sf org login web`. Streaming and bulk ingestion, Direct token commands, and `api request --direct` use Data 360 Direct APIs and additionally require a Salesforce External Client App (ECA). The plugin performs Salesforce's two-step token exchange automatically and never requires you to paste a Data 360 tenant token into a command.

## Prerequisites

- A Salesforce org provisioned for Data 360.
- A user with the Data 360 permissions required by the APIs they will call.
- An admin-managed ECA configured for the OAuth flow your organization approves.
- The ECA consumer key stored through your organization's approved secret-management workflow. Never commit it or paste auth URLs, access tokens, tenant tokens, or consumer secrets into issues or test fixtures.

Salesforce's current [Data 360 API quick start](https://developer.salesforce.com/docs/data/data-cloud-dev/guide/dc-quick-start.html) describes the org, permission, ECA, OAuth, and two-token prerequisites. Follow the linked Salesforce Help procedures to create the ECA and configure its OAuth policies, or use the plugin's setup command below.

## Create the ECA with the CLI

`sf data360 setup eca` provisions the ECA programmatically through the Metadata SOAP API — the same mechanism Salesforce documents for source-driven ECA creation — and prints the consumer key plus the exact reauthorization command:

```shell
sf data360 setup eca --target-org <org-alias> --app-name D360CLI
```

The command is idempotent: rerunning it detects an existing app and still retrieves the consumer key. Newly created apps can take up to 30 minutes to become fully operational. If your org disables External Client Apps or your user lacks the required admin permissions, create the app through Setup as described in the linked Salesforce Help procedures instead.

The generated browser-flow policy enables authorization-code flow with PKCE, keeps client-credentials and token-exchange flows disabled, and does not require a consumer secret. These defaults match the printed `sf org login web` workflow and avoid enabling unrelated grants. Organizations with a different approved OAuth policy should create or manage the ECA centrally instead of weakening it ad hoc from the CLI.

## Required OAuth scopes

Enable only the scopes needed by your workflows:

| Scope             | Used for                                                         |
| ----------------- | ---------------------------------------------------------------- |
| `api`             | Salesforce platform API access used by the authenticated CLI org |
| `web`             | Salesforce browser-based web server OAuth flow                   |
| `refresh_token`   | Refreshing an eligible browser-flow authorization                |
| `cdp_api`         | General Data 360 tenant APIs and metadata                        |
| `cdp_query_api`   | Direct Query API requests made with `api request --direct`       |
| `cdp_profile_api` | Direct Profile API requests made with `api request --direct`     |
| `cdp_ingest_api`  | Streaming and bulk Ingestion APIs                                |

`sf data360 doctor` checks the four `cdp_*` scopes above because it is a full readiness check. A Connect-only workflow does not require those Direct scopes. An exchange response can omit its scope inventory; in that case doctor reports a warning and only claims the Direct metadata access it actually verified.

## Authorize a CLI org alias

Use a browser flow with the ECA consumer key and the scopes approved by your admin. Replace every angle-bracket placeholder locally:

```shell
sf org login web \
  --instance-url <my-domain-url> \
  --client-id <eca-consumer-key> \
  --alias <org-alias> \
  --scopes "api web refresh_token cdp_api cdp_query_api cdp_profile_api cdp_ingest_api"
```

The installed Salesforce CLI documents the exact flags for your version in `sf org login web --help`. Don't add scopes that the ECA or your user isn't approved to use.

Verify the resulting authorization without printing tokens:

```shell
sf data360 doctor --target-org <org-alias>
sf data360 metadata list --limit 1 --target-org <org-alias>
```

Treat a doctor warning as a warning rather than rewriting it as a pass. Resolve failed token exchange, tenant metadata, or required-scope checks before enabling mutations or billable ingestion.

## CI authentication

Use a Salesforce CLI authentication method approved for your environment, such as a protected SFDX auth URL or JWT flow, and store credentials as masked environment secrets. The plugin consumes the authenticated org connection; it doesn't define a separate credential format. Keep mutation and billing gates disabled by default.

## Troubleshooting

- **Exchange succeeds but no tenant token is returned:** confirm the ECA scopes and the session or OAuth flow used to authenticate the org, then reauthorize and rerun doctor.
- **`invalid subject token`:** ask the ECA owner to verify the app registration, keys, and authorization rather than copying local auth files between users.
- **A Direct call returns a missing-scope error:** add the specific scope named in the error, reauthorize the org, and rerun doctor.
- **Ingestion remains unauthorized in a demo or SDO org:** ask the org owner to verify that the environment supports and has activated the required Ingestion grant. Don't infer support from Query API success.
- **Enterprise proxy:** token exchange, Direct API, and raw Direct requests honor `HTTPS_PROXY`/`HTTP_PROXY` and `NO_PROXY`. Keep proxy credentials in the environment or approved secret manager, never in command arguments or diagnostics. The plugin redacts credentialed proxy URLs from configuration errors.
- **Cached auth or job state is corrupt or from an older plugin version:** current caches carry a schema version, migrate supported legacy entries, and discard corrupt entries. Reauthenticate or resubmit the job if the plugin can't safely recover it; don't hand-edit encrypted token values.

For shared internal live testing, use your team's private environment runbook. It must define environment ownership, independent mutation and billing approvals, cleanup, and credential-handling rules; those environment-specific details do not belong in this public setup guide.
