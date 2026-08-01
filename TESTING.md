# Testing

## Package manager

The project uses the Yarn Classic version pinned by `packageManager`. Activate it through Corepack before running project scripts:

```bash
corepack enable
corepack prepare yarn@1.22.22 --activate
```

## Local gates

```bash
yarn install --frozen-lockfile
yarn public:check
yarn build
yarn lint
yarn format:check
yarn test
yarn test:t2
yarn secrets:scan
yarn contract:check
yarn test:eval
yarn test:coverage
yarn help:smoke
yarn pack --filename sf-plugin-data360.tgz
yarn test:package sf-plugin-data360.tgz
```

The broad command tests invoke command classes through real oclif parsing and use deterministic client or HTTP fixtures at the authenticated transport boundary. They never replace `parse()`. The T2 subprocess sentinel described below adds a representative compiled executable boundary.

The coverage gate instruments all non-command runtime source and requires at least 85% for lines, branches, functions, and statements. Command files are covered by the manifest-driven parsing, message, schema, fixture, help, and criteria contracts instead of being omitted without a replacement gate. `yarn secrets:scan` checks tracked working-tree files, staged index blobs, and all historical blobs reachable from the selected release ref without printing matched values; it is also part of `contract:check`, pre-push, and full-history CI. Package smoke is a separate distribution gate: it validates the real compressed tarball against the public-file allowlist, requires a v3 npm shrinkwrap that locks every runtime dependency, installs that tarball in isolation, and invokes it through a pinned stable Salesforce CLI. This catches accidental private/source-only files, missing `files` entries, generated-artifact failures, and runtime-dependency failures that source-tree tests cannot.

## Git pre-push gate

Run `yarn hooks:install` after cloning to install the versioned `.githooks/pre-push` hook. Hook setup is deliberately not an npm `prepare`/install lifecycle, so installing the published plugin has no contributor-worktree side effects and remains compatible with npm's non-interactive install-script policy. The hook runs secrets scanning, clean compilation, contract and deterministic-generation checks, topic/command help smoke, lint, formatting, unit/mock tests, evaluation, coverage, security, performance, and installed-package smoke:

```bash
yarn hooks:install
```

## Mock server

`test/mock/server.ts` loads `test/fixtures/manifest.json` and supports deterministic fault injection:

- `?__mock429=1` returns HTTP 429.
- `?__mockDelay=<milliseconds>` delays the response.

Direct API mock clients honor `SF_DATA360_TENANT_URL` only when `NODE_ENV=test` and only for loopback hosts. The mock exchange fixture dynamically returns the running server URL, so the exchange-to-Direct round trip is runnable without external network access.

## Fixture provenance

Fixtures contain a `__fixture` record:

- `live-scrubbed`: captured from a connected Data 360 org and scrubbed.
- `synthetic`: constructed from verified official documentation.

Synthetic fixtures from a current primary-source contract are accepted for explicitly labeled `0.x` beta commands and unit/mock development. Unverified endpoints cannot use synthetic fixtures. GA requires successful scrubbed live evidence for each GA command.

Use:

```bash
node scripts/scrub-fixture.mjs raw.json > test/fixtures/family/operation.json
```

Never commit access tokens, usernames, org domains, tenant hosts, or real record identifiers.

## T2 mock-integration boundary

T2 is intentionally hybrid. `yarn test:nuts:mock:subprocess` uses `TestSession` and `execCmd` to launch the compiled CLI in a child process, runs `data360 query` against the Fastify HTTP fixture server, and also exercises a parser failure through the real executable boundary. The broader parser/mock lifecycle matrix runs in-process with real oclif parsing and deterministic client or HTTP fixtures; it covers pagination, retries, Direct token exchange, job polling, and output/error contracts without replacing `parse()`.

The child-process NUT uses a test-only `Org.create` preload because Salesforce Core does not reliably accept a dummy loopback access-token org over plain HTTP. It proves the compiled command-process boundary for the representative query path; it does not imply that all 135 commands run as separate processes. `yarn test:t2` combines that subprocess sentinel with the broad in-process mock demo. The installed-tarball smoke is a separate package/distribution gate (`yarn test:package`), not part of T2.

The P2 in-process mock lifecycle performs the complete exchange against the Fastify route, consumes its dynamically generated loopback tenant URL, and sends the resulting bearer token through `DirectClient` to the mock metadata endpoint.

## Agent Testbed

`yarn test:nuts:mock:testbed` adds a compiled-CLI smoke session to T2. The broader source-only harness under [`testbed/`](testbed/README.md) can run smoke, query, ingestion, adversarial, and end-to-end journey suites while recording redacted command and HTTP JSONL traces. It validates evidence references and compares independent agent/model personas so a shared assertion failure is distinguishable from a one-agent usage or documentation problem.

```bash
node testbed/bin/testbed.mjs start --agent local-reviewer --model human --mode mock
node testbed/bin/testbed.mjs run --suite smoke
node testbed/bin/testbed.mjs end
node testbed/bin/testbed.mjs report --since 7d --format both
```

PR and nightly CI run all five mock suites for two scripted personas and retain only the explicit, validated session/event/result/raw artifact allowlist for 30 days. Runtime homes, logs, and caches are outside that artifact boundary. The harness launches compiled `bin/run.js` directly; the separate package smoke proves installation and discovery through a real Salesforce CLI. Declarative live suites are structurally read-only; gated mutations and billing use the `live-verify` wrapper.

## Scheduled live read-only gate

The credentialed scheduled workflow runs `yarn test:nuts:live:readonly`, covering the safe read-only P1, P2, P4, P5, and P6 smoke slices. It suppresses response bodies where appropriate and does not enable mutation or billing gates. P3 ingestion, billable actions, mutations, and reads that depend on disposable resources remain explicit, separately approved runs.

## REPL verification

Parser and session tests inject input, output, callbacks, history paths, and terminate deterministically in CI. The packaged [Query REPL operator checklist](docs/REPL_CHECKLIST.md), which permits at most one explicitly approved, bounded live query, passed in a real pseudo-TTY for the Query/REPL contract digest retained in the repository-only sanitized evidence. The contract gate verifies that digest; rerun or explicitly acknowledge the evidence for each release scope.

Live tests require `D360_LIVE_ORG` (the org alias or username) and the corresponding `TESTKIT_AUTH_URL` CI secret. Follow [LIVE_TESTING.md](LIVE_TESTING.md) for access to the dedicated trial org, scoped browser OAuth, environment setup, approval gates, and cleanup ownership. Do not run billable queries from the smoke path.

`scripts/smoke-p2.sh` checks token display, Direct metadata, and doctor without emitting the JWT. A missing External Client App scope is an expected live blocker and does not affect the mock gate.

## P3 ingestion

Unit tests exercise byte-bounded JSON/NDJSON chunking, header-preserving CSV splitting (including quoted newlines), raw CSV transport, seven-day job caching, lifecycle wire shapes, and timeout exit 69 metadata. Synthetic fixtures cover documented streaming and bulk states.

`yarn test:ingest:large` generates a temporary CSV above 150,000,000 bytes, verifies strict decimal-cap splitting, and removes all generated files. Normal tests inject small limits. Bulk upload uses bounded-memory temporary parts, POSIX mode `0600` where supported, and streaming backpressure. Data 360 documents at most 100 uploaded data files per job; the command enforces that API limit rather than imposing an invented record or credit cap.

The P3 mock NUT uses a stateful Fastify server and real `fetch` transport after token exchange. It covers all seven commands, timeout 69 followed by successful resume, abort races, validation reports, failed jobs, and partial completion. The verification matrix marks mock coverage only after this lifecycle passes.

The query large-result soak streams 100,000 rows over 50 fixture pages through a deliberately slow writable, injects one HTTP 429 mid-stream, and asserts that the next page is not fetched until the current page drains. This proves the one-page in-flight/backpressure invariant. It does **not** sample process RSS, so a literal memory-budget claim remains open until an RSS-instrumented run is added.

Live ingestion is intentionally separate because it writes data and consumes credits. `scripts/smoke-p3.sh` requires `D360_LIVE_ORG`, `D360_LIVE_BILLABLE=1`, a disposable connector/object, and a sample file. Do not run it without External Client App scope, connector, and credit approval.

## P6 verification gate

P6 beta commands require a primary-source endpoint contract before implementation; GA still requires successful live evidence. The current org verified Retriever list/detail/configuration reads, Document AI global capabilities, and dedicated collection commands for Document AI configurations, semantic models, Data Actions, and Data Action targets. Empty collections validate collection envelopes only; they do not define detail or mutation payloads.

The ten Data Kit commands are implemented from the official v67 OpenAPI contract and pass unit/mock contracts. They remain mock-only: the live list probe did not complete reliably and `available-components` returned HTTP 500. The v67 contract defines no get-single or deployment-job status operation, so the CLI does not invent either one. See [`docs/API_COVERAGE.md`](docs/API_COVERAGE.md) for the operation-level boundary and [`VERIFICATION.md`](VERIFICATION.md) for the 68 individually live-dated commands.
