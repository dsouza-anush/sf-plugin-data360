# Get started with the experimental Data 360 CLI plugin

> **Experimental release:** `sf-plugin-data360` is an unsupported `0.x` beta. Every command is marked beta. Pin the exact plugin version in automation, start in a non-production org, and review the command's help before allowing mutations or credit-consuming work.

The plugin adds scriptable Data 360 operations to Salesforce CLI. It is intended for developers, solution engineers, and release reviewers who need repeatable command-line access to Data 360 metadata, queries, ingestion, data-foundation resources, identity and audience workflows, and selected search and AI-adjacent resources.

This guide covers the shortest safe path from a source checkout to a read-only result. Use the [generated command reference](COMMAND_REFERENCE.md) for every command and flag, and the [API coverage ledger](API_COVERAGE.md) before depending on a workflow for release or production use.

## Understand the beta boundary

At the 2026-07-29 review snapshot:

- The manifest and verification ledger contain 135 commands with unit and mock coverage.
- 102 exact commands have successful, scrubbed, checked-in live-org evidence. A live result for one command does not verify the other commands in its family.
- Eight Data Kit commands have successful live fixtures: list, available components, component status, manifest, create, update, delete, and undeploy. Deploy and component dependencies remain org- or platform-blocked.
- `sf data360 api request` extends raw API reach; it is not equivalent to a dedicated command with typed flags, confirmations, pagination, and command-level verification.
- This evidence is suitable for a reviewed experimental beta, not a GA support claim.

Check [VERIFICATION.md](../VERIFICATION.md) for command-level dates. An empty live column means there is no qualifying successful public fixture for that exact command. It does not necessarily mean the command was never attempted: failed, platform-blocked, safety-gated, and credit-gated runs remain undated.

## Prerequisites

- Node.js 22.19 or later in the 22.x line, or Node.js 24.
- A current Salesforce CLI installation.
- A Salesforce org with Data 360 provisioned.
- A user with the Data 360 permissions required by the commands you plan to run.
- For Direct API access, an approved External Client App (ECA) and its required `cdp_*` scopes.

## Install a review build from source

The npm owner and final published package name are still release decisions. Until the release notes name an exact package and version, review the plugin from its source checkout:

```shell
git clone https://github.com/dsouza-anush/sf-plugin-data360.git
cd sf-plugin-data360
corepack enable
yarn install --frozen-lockfile
yarn build
sf plugins link .
sf plugins
sf data360 --help
```

`sf plugins` should show `sf-plugin-data360` linked to this checkout. Re-run `yarn build` after source or message changes. For the reviewed-package, unsigned-plugin, update, and uninstall flows, see [Install and verify the plugin](INSTALLATION.md).

## Authenticate and run diagnostics

First create a normal Salesforce CLI authorization:

```shell
sf org login web --alias my-org
sf data360 doctor --target-org my-org
```

Doctor checks org authentication, API-version alignment, Data 360 provisioning, data spaces, Direct API token exchange, a Direct API ping, required scopes, and the configured data space. It exits nonzero when any check fails. If only the Direct checks fail, core-org SSOT commands can still be available, but you should not use Direct API workflows until those failures are resolved.

Direct API workflows require an ECA. An admin can manage it centrally, or an authorized reviewer can create the plugin's browser-flow configuration:

```shell
sf data360 setup eca --target-org my-org --app-name D360CLI
```

The command prints the consumer key and an `sf org login web` command with the required scopes. Review that command before running it. New apps can take up to 30 minutes to become operational. Then reauthorize the alias and rerun doctor. See [Configure Direct API authentication](EXTERNAL_CLIENT_APP.md) for the scope table, OAuth policy, CI guidance, and troubleshooting.

## Run a read-only first workflow

Start by discovering a Data Model Object (DMO) that exists in your org:

```shell
sf data360 metadata list \
  --entity-type DataModelObject \
  --limit 5 \
  --target-org my-org
```

Inspect one result, then query it. Replace `<dmo-api-name>` with the API name returned by metadata:

```shell
sf data360 metadata get \
  --name <dmo-api-name> \
  --target-org my-org

sf data360 query \
  --query 'SELECT * FROM "<dmo-api-name>" LIMIT 5' \
  --target-org my-org
```

Use `--json` for automation. Structured commands return the standard Salesforce CLI JSON envelope and keep status and timing messages on stderr:

```shell
sf data360 metadata list \
  --entity-type DataModelObject \
  --limit 5 \
  --target-org my-org \
  --json > dmos.json
```

`sf data360 api request` is the exception: it writes raw response bytes and intentionally does not support `--json`.

## Continue an asynchronous query

For longer queries, submit asynchronously and use the local most-recent job pointer:

```shell
sf data360 query \
  --query 'SELECT COUNT(*) FROM "<dmo-api-name>"' \
  --async \
  --target-org my-org

sf data360 query resume --use-most-recent

sf data360 query results \
  --use-most-recent \
  --result-format csv \
  --output-file rows.csv
```

Use an explicit query ID in shared runners or whenever more than one job can be active. The most-recent pointer is local user state, not a cross-machine job registry.

## Choose the right command family

| Goal                                   | Start with                                                                      | Notes                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Validate an environment                | `sf data360 doctor`                                                             | Holistic checks include both core-org and Direct API access.          |
| Discover objects and fields            | `sf data360 metadata list`                                                      | Read-only; use metadata results to avoid guessing API names.          |
| Run SQL or use the REPL                | `sf data360 query`                                                              | Omit query input in an interactive terminal to enter the REPL.        |
| Stream or bulk ingest records          | `sf data360 ingest validate`                                                    | Validate input first; ingestion consumes Data 360 credits.            |
| Build the data foundation              | `connection`, `data-stream`, `dlo`, `dmo`, `mapping`, `transform`, `data-space` | List and inspect shared resources before creating or changing them.   |
| Build customer outcomes                | `identity-resolution`, `calculated-insight`, `segment`, `activation`            | Many mutations are only partially live-verified; check the ledger.    |
| Work with search and graphs            | `search-index`, `data-graph`, `retriever`                                       | Vector and hybrid query builders remain live-dialect-gated.           |
| Inspect selected AI-adjacent resources | `docai`, `semantic model`, `data-action`                                        | The dedicated surface is primarily live-verified reads.               |
| Package Data 360 metadata              | `data-kit`                                                                      | Eight commands are live-verified; deploy remains org-gated.           |
| Reach an unwrapped endpoint            | `sf data360 api request`                                                        | Raw transport has fewer workflow safeguards than a dedicated command. |

Run `sf <command> --help` for the installed version, for example:

```shell
sf data360 segment publish --help
```

## Use the automation contract deliberately

- Always pass `--target-org` in scripts. Avoid relying on a developer's default org.
- Pin the plugin version once a package is published; do not install an unbounded `latest` in CI.
- Prefer `--json` and check both the process exit code and the JSON `status` field.
- Commands that require destructive confirmation fail closed in JSON or noninteractive mode. Use `--no-prompt` only after your automation has independently validated the org, resource name, and intended action.
- File-taking commands commonly support `--file -` for stdin. Store reviewed payloads alongside the automation that uses them.
- Query commands support `--result-format` and `--output-file`; do not parse human tables.
- Add `--timing` when diagnosing latency. Timing and status output go to stderr.
- Use `--no-token-cache` on Direct commands when policy requires bypassing persistent token-cache reads and writes.

Data-space resolution is, in order: the command flag, `SF_DATA360_DATA_SPACE`, local Salesforce CLI config, global config, then `default`. Set it explicitly for shared automation:

```shell
sf config set data360-data-space=default
```

## Protect data, credentials, and credits

- Begin in an isolated trial, test, or otherwise approved non-production org.
- Run the corresponding list/get/describe command before a create, update, delete, publish, deploy, undeploy, run, or refresh action.
- Treat ingestion and `data-stream run`, `transform run`, `identity-resolution run`, `calculated-insight run`, and `segment publish` as credit-consuming operations. Review Data 360 usage policy and org ownership before running them.
- Do not treat `--no-prompt` as approval. It only tells the command that approval happened elsewhere.
- Never commit Salesforce auth URLs, access tokens, tenant tokens, ECA keys, consumer secrets, proxy credentials, or raw live-response captures.
- Keep `--target-org`, data-space selection, resource names, and cleanup ownership visible in change review.

## Troubleshoot a first run

- **Core checks pass but Direct checks fail:** configure or reauthorize the ECA, then rerun doctor. Core-org commands can remain usable while Direct workflows are blocked.
- **The configured data space is missing:** run `sf data360 data-space list`, then pass `--data-space` or update `data360-data-space`.
- **A scope is missing:** add only the scope named by doctor or the API error, reauthorize the org, and retry.
- **A command is absent or its flags differ:** confirm the linked or installed version with `sf plugins`, then use `sf <command> --help` for that exact build.
- **A list succeeds but a mutation fails:** do not infer mutation support from the list result. Check the exact command in [VERIFICATION.md](../VERIFICATION.md).
- **An enterprise proxy is required:** Direct exchange and request paths honor `HTTPS_PROXY`, `HTTP_PROXY`, and `NO_PROXY`. Keep proxy credentials out of command arguments and captured diagnostics.

## Continue the review

- [Install and verify the plugin](INSTALLATION.md)
- [Configure Direct API authentication](EXTERNAL_CLIENT_APP.md)
- [Generated command reference](COMMAND_REFERENCE.md)
- [API and workflow coverage](API_COVERAGE.md)
- [Curated example inputs](../examples/README.md)
- [Command-level verification matrix](../VERIFICATION.md)
- [Security policy](../SECURITY.md)
