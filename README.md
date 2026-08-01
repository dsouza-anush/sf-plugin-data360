<div align="center">
  <img src="assets/data360-mark.svg" alt="Salesforce Data 360 product mark" width="112">
  <h1>Data 360 CLI Plugin</h1>
  <p>Query, ingest, model, and operate Salesforce Data 360 from the Salesforce CLI.</p>

<a href="https://github.com/dsouza-anush/sf-plugin-data360/actions/workflows/test.yml"><img alt="Test status" src="https://github.com/dsouza-anush/sf-plugin-data360/actions/workflows/test.yml/badge.svg"></a>
<a href="https://oclif.io"><img alt="Built with oclif" src="https://img.shields.io/badge/cli-oclif-5a45ff.svg"></a>
<img alt="Node.js 22 or 24" src="https://img.shields.io/badge/node-22%20%7C%2024-339933.svg">
<a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</div>

> [!IMPORTANT]
> **Experimental beta.** This community project is not an official Salesforce product and ships without Salesforce support or warranty. Review the [verification boundary](VERIFICATION.md), test in a non-production org, and understand which commands can consume credits or mutate data before use.

`sf-plugin-data360` adds Salesforce Data 360 (formerly Data Cloud) commands to the [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli). It uses the CLI's existing org authentication and conventions so Data 360 workflows can move from Setup into a terminal or CI job.

```console
$ sf data360 query --query 'SELECT COUNT(*) FROM "ssot__Individual__dlm"' --target-org my-org
$ sf data360 ingest bulk --source-name connector --object-name runner_profiles --file leads.csv --target-org my-org
$ sf data360 segment publish --name HighValueRunners --target-org my-org
```

The plugin provides 135 `sf data360` commands with the same org auth, `--json` envelope, help system, and exit-code conventions as the rest of `sf`, plus an interactive SQL REPL. All 135 commands have unit and mocked HTTP coverage; 104 also have successful, scrubbed, command-specific live-org evidence. A missing live date can indicate an org prerequisite, a platform limitation, or an intentionally unrun billable or destructive fixture. [VERIFICATION.md](VERIFICATION.md) is the exact evidence ledger, and [docs/API_COVERAGE.md](docs/API_COVERAGE.md) explains the gaps.

## What you can do

- Query Data 360 with SQL, vector, and hybrid search, including asynchronous jobs and a terminal REPL.
- Stream or bulk ingest data and manage connections, streams, lake objects, model objects, mappings, and transforms.
- Operate identity resolution, calculated insights, segments, activations, data graphs, search indexes, profiles, and data kits.
- Script safely with JSON schemas, stable error codes, explicit confirmation boundaries, and deterministic command documentation.

## Requirements

- Node.js 22.19+ (22.x line) or Node.js 24
- Salesforce CLI (`sf`)
- An org with Data 360 provisioned

## Install

The package is not yet published to npm. For private review, install from a source checkout:

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

After the first npm release, the conventional install will be:

```bash
sf plugins install sf-plugin-data360@0.1.0
```

Until that version exists on npm, use the source path above. See [docs/INSTALLATION.md](docs/INSTALLATION.md) for trust prompts, pinned CI installs, updates, and uninstall instructions.

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

[ARCHITECTURE.md](ARCHITECTURE.md) explains the runtime layers and repository layout. [CONTRIBUTING.md](CONTRIBUTING.md) covers workflow and expectations, [TESTING.md](TESTING.md) explains the test tiers (T1–T7), and [LIVE_TESTING.md](LIVE_TESTING.md) is the runbook for the gated, billable live suites (`D360_LIVE_ORG` + `D360_LIVE_BILLABLE=1`). Release gates live in [docs/RELEASE.md](docs/RELEASE.md); security policy in [SECURITY.md](SECURITY.md).

Example payloads for queries, ingestion, and data kits are under [examples/](examples/README.md).

## Project documentation

| Need                                 | Start here                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Install and run a safe first command | [Getting started](docs/GETTING_STARTED.md)                                                  |
| Find a command or flag               | [Complete command reference](docs/COMMAND_REFERENCE.md)                                     |
| Configure Direct API OAuth           | [External Client App setup](docs/EXTERNAL_CLIENT_APP.md)                                    |
| Understand API and live-org coverage | [API coverage](docs/API_COVERAGE.md) and [verification ledger](VERIFICATION.md)             |
| Build or contribute                  | [Architecture](ARCHITECTURE.md), [contributing](CONTRIBUTING.md), and [testing](TESTING.md) |
| Prepare a release                    | [Release guide](docs/RELEASE.md)                                                            |
| Report a vulnerability               | [Security policy](SECURITY.md)                                                              |

Salesforce CLI plugins use the [oclif plugin framework](https://oclif.io/docs/introduction). The official [Salesforce CLI plugin developer guide](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide) explains the host CLI architecture and plugin lifecycle.

## Issues and support

Use [GitHub Issues](https://github.com/dsouza-anush/sf-plugin-data360/issues) for reproducible bugs and feature requests. Do not include credentials, customer data, org identifiers, raw live responses, or private metadata. Security issues must use the private route in [SECURITY.md](SECURITY.md).

## Acknowledgements

Selected algorithms and UX ideas — pagination dialects, metadata-ordered result columns, name-resolution suggestions — were adapted from the MIT-licensed [Jaganpro/sf-cli-plugin-data360](https://github.com/Jaganpro/sf-cli-plugin-data360). If you're migrating from that plugin: `query async-create` → `query --async`, `query async-status` → `query resume`, `query async-rows` → `query results`.

## License

[MIT](LICENSE)
