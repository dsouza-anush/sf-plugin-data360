# sf-plugin-data360

Salesforce Data 360 (Data Cloud) commands for the [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli). Query, ingest, model, and operate a Data 360 tenant from your terminal or CI instead of clicking through Setup.

```console
$ sf data360 query --query 'SELECT COUNT(*) FROM "ssot__Individual__dlm"' --target-org my-org
$ sf data360 ingest bulk --source-name connector --object-name runner_profiles --file leads.csv --target-org my-org
$ sf data360 segment publish --name HighValueRunners --target-org my-org
```

The plugin adds 135 `sf data360` commands that behave like the rest of the CLI: same org auth, same `--json` envelope, same help system, plus an interactive SQL REPL for exploratory work.

> **Status: experimental beta.** This is not an official Salesforce product and ships without support or warranty. All 135 commands have unit and mocked HTTP coverage; 102 additionally have successful, scrubbed, command-specific live-org evidence. A command without a live date was not necessarily never attempted: it may have failed or been blocked by org/platform prerequisites, or it may require a disposable billable or destructive fixture that was intentionally not run against shared assets. [VERIFICATION.md](VERIFICATION.md) tracks the exact successful evidence, and [docs/API_COVERAGE.md](docs/API_COVERAGE.md) explains the remaining gaps.

## Requirements

- Node.js 22.19+ (22.x line) or Node.js 24
- Salesforce CLI (`sf`)
- An org with Data 360 provisioned

## Installation

The package is not yet published to npm. From a source checkout:

```bash
git clone https://github.com/dsouza-anush/sf-plugin-data360.git
cd sf-plugin-data360
corepack enable
yarn install --frozen-lockfile
yarn build
sf plugins link .
```

Verify the link and your org in one step:

```bash
sf data360 doctor --target-org my-org
```

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for the published-package and unsigned-plugin paths once a release is announced, and for update and uninstall instructions.

## Quick start

Check connectivity, look around, run a query:

```bash
sf data360 doctor --target-org my-org
sf data360 metadata list --limit 5 --target-org my-org
sf data360 query --query 'SELECT * FROM "ssot__Individual__dlm" LIMIT 5' --target-org my-org
```

Long-running queries can run asynchronously and be picked up later — including from a different shell:

```bash
sf data360 query -q 'SELECT COUNT(*) FROM "ssot__Individual__dlm"' --async -o my-org
sf data360 query resume --use-most-recent
sf data360 query results --use-most-recent --result-format csv --output-file rows.csv
```

Or skip the flags entirely: running `sf data360 query` with no `--query` in a terminal opens a REPL with multiline SQL (terminated by `;`), persistent history, and psql-style meta commands (`\dt`, `\d`, `\f`, `\x`, `\o`, `\dataspace`, `\timing`, `\i`, `\last`, `\q`).

For a guided first session, start with [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

## Commands

Every command, flag, and example is generated into [docs/COMMAND_REFERENCE.md](docs/COMMAND_REFERENCE.md); `sf data360 --help` shows the same content. The surface by area:

| Area              | Topics                                                                                       | Highlights                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Query             | `query`                                                                                      | Query SQL v3, typed parameter bindings, async submit/resume/results/cancel, vector and hybrid builders, REPL |
| Ingestion         | `ingest`                                                                                     | Streaming JSON/NDJSON and bulk CSV with validate, report, resume, cancel, and delete                         |
| Data foundation   | `connection`, `connector`, `data-stream`, `dlo`, `dmo`, `mapping`, `transform`, `data-space` | Create and manage the objects a tenant is built from, end to end                                             |
| Outcomes          | `identity-resolution`, `calculated-insight`, `segment`, `activation`, `activation-target`    | Run rulesets, publish segments, manage activations and their result data                                     |
| Graphs & profiles | `data-graph`, `profile`, `search-index`                                                      | Refresh and query data graphs, read unified profiles, manage search indexes                                  |
| AI & agents       | `retriever`, `docai`, `semantic model`, `data-action`, `data-action-target`                  | Read retrievers, Document AI configs, semantic models, and data actions                                      |
| Data Kit          | `data-kit`                                                                                   | List, inspect, create, update, delete, deploy, and undeploy data kits; eight commands are live-verified      |
| Utilities         | `doctor`, `open`, `token`, `api`, `metadata`, `setup`                                        | Diagnostics, open the org UI, token display, raw API escape hatch, org prerequisites                         |

`sf data360 api request` sends raw authenticated requests to Connect or Direct API paths the dedicated commands don't wrap yet. It emits raw response bytes and is the one command that intentionally has no `--json` envelope.

## Authentication

Commands that use the Connect API work with your normal `sf` org auth — no extra setup.

Direct API commands (query, ingestion, profile) need an External Client App authorized with the relevant `cdp_api`, `cdp_query_api`, `cdp_profile_api`, and `cdp_ingest_api` scopes. [docs/EXTERNAL_CLIENT_APP.md](docs/EXTERNAL_CLIENT_APP.md) walks through the admin setup, login, CI usage, and troubleshooting; `sf data360 doctor` validates the token exchange and scope inventory.

Tenant tokens are cached per username in `~/.sf/data360-token-cache.json`, encrypted with the same keychain-backed crypto the CLI uses for org auth, and expired five minutes early. Pass `--no-token-cache` to bypass the cache entirely.

## Configuration

```bash
sf config set data360-data-space=default
sf config set data360-credit-notices=true
```

Data-space resolution order: `--data-space` flag, `SF_DATA360_DATA_SPACE`, local config, global config, then `default`.

## Scripting and automation

The plugin is built to be scripted against:

- Structured commands support `--json` and ship JSON schemas (in `schemas/`) for their results.
- Errors carry stable `D360_*` codes with suggested next steps; automation should check both the exit code and the JSON status.
- Exit codes are semantic: `0` success, `1` runtime failure, and `2` usage error; applicable workflows also use `68` for partial record failure, `69` for timeout, and `130` for interruption.
- Tabular commands support `--result-format human|csv|json` and `--output-file`.
- Destructive commands that require confirmation prompt in a terminal and require `--no-prompt` in CI.

The full rules — output streams, error shape, compatibility promises — are in [docs/CLI_CONTRACT.md](docs/CLI_CONTRACT.md).

A note on cost: ingestion (and some downstream operations) consume Data 360 credits. Streaming requests are capped at 200,000 bytes and bulk CSV parts at 150,000,000 bytes, matching the documented API limits.

## Development

```bash
corepack enable
yarn install --frozen-lockfile
yarn build          # compile + regenerate schemas, snapshot, manifest, docs
./bin/dev.js data360 --help
yarn test           # unit + mock-integration suites
yarn lint
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers workflow and expectations, [TESTING.md](TESTING.md) explains the test tiers (T1–T7), and [LIVE_TESTING.md](LIVE_TESTING.md) is the runbook for the gated, billable live suites (`D360_LIVE_ORG` + `D360_LIVE_BILLABLE=1`). Release gates live in [docs/RELEASE.md](docs/RELEASE.md); security policy in [SECURITY.md](SECURITY.md).

Example payloads for queries, ingestion, and data kits are under [examples/](examples/README.md).

## Acknowledgements

Selected algorithms and UX ideas — pagination dialects, metadata-ordered result columns, name-resolution suggestions — were adapted from the MIT-licensed [Jaganpro/sf-cli-plugin-data360](https://github.com/Jaganpro/sf-cli-plugin-data360). If you're migrating from that plugin: `query async-create` → `query --async`, `query async-status` → `query resume`, `query async-rows` → `query results`.

## License

[MIT](LICENSE)
