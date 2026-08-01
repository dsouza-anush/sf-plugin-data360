# Live Data 360 testing

Use this runbook for safe verification against an authorized, non-production Data 360 org. It intentionally contains no org aliases, usernames, domains, tenant identifiers, External Client App names, retained resource identifiers, credentials, or customer data.

Repository maintainers who operate a shared test environment must keep its ownership, renewal, authorization, and retained-resource details in an access-controlled system outside the public source tree. Local working material may use the ignored `internal/` directory, but secrets still belong in an approved secret manager.

## Required authorization

Before testing, confirm that:

- the org owner has authorized your assigned user;
- the org is non-production and provisioned for the capabilities being tested;
- the External Client App has only the required Data 360 scopes;
- mutations have explicit approval and use disposable resources; and
- billable operations have separate credit approval.

Authenticate through an owner-approved Salesforce CLI flow. Never copy another engineer's auth files, place an auth URL in the repository, or pass a consumer key through shell history. Verify the authorization without sharing its output:

```bash
sf org display --target-org <test-org>
sf data360 doctor --target-org <test-org>
```

## Environment controls

Set only the controls needed by the current process:

- `D360_LIVE_ORG` — authorized non-production org alias or username.
- `TESTKIT_AUTH_URL` — CI-only auth material stored as a masked, protected environment secret.
- `D360_LIVE_MUTATIONS=1` — explicit acknowledgement for an approved disposable mutation run.
- `D360_LIVE_BILLABLE=1` — separate acknowledgement after credit approval.
- `D360_LIVE_SHARED_DATA=1` — opt in only for a disposable demo org where an approved probe may read, reference, refresh, or run an existing test resource. It never relaxes mutation, billing, ownership, or cleanup gates.
- `D360_INGEST_SOURCE` and `D360_INGEST_OBJECT` — approved retained or disposable ingestion source/object names.
- `D360_STREAM_ID`, `D360_STREAM_API_NAME`, and `D360_DLO_NAME` — approved test-only retained resource identifiers for exact read-only checks.
- `D360_TRANSFORM_NAME` — an approved exact test transform for a bounded paid run. The harness verifies that it is active or ready before dispatch.
- `D360_INGEST_SAMPLE`, `D360_INGEST_INVALID_SAMPLE`, `D360_INGEST_CSV`, and `D360_INGEST_VERIFY_SQL` — required, environment-specific local inputs for an external retained-resource foundation run. The harness refuses to substitute its internal disposable schema because retained object schemas vary by environment.

Mutation and billing gates are independent. Do not put either gate in a shell profile, tracked environment file, or default CI configuration.

## Read-only smoke

Start with the composite read-only smoke. It covers the safe P1, P2, P4, P5, and P6 command slices, suppresses response bodies, performs no mutations, and does not submit a billable query:

```bash
export D360_LIVE_ORG=<test-org>
yarn test:nuts:live:readonly
```

The individual scripts remain available for diagnosis:

```bash
scripts/smoke-p1.sh "$D360_LIVE_ORG"
scripts/smoke-p2.sh
scripts/smoke-p4.sh
scripts/smoke-p5.sh
scripts/smoke-p6.sh
```

A successful family list does not promote sibling get, create, update, delete, action, or billable commands. Update a command's live date only from successful, scrubbed evidence for that exact command.

The release verification phases are intentionally distinct: P1 checks the platform foundation, P2 checks Data 360 authentication and query transport, P3 covers approved billable ingestion, P4 covers disposable metadata lifecycles, P5 covers advanced query and metadata families, and P6 probes the remaining source-verified read surfaces. A phase may remain partially blocked even when the composite read-only smoke succeeds.

## Mutations and billable operations

Use the scenario harness for approved disposable mutations because it records cleanup before creation, persists a resumable ledger, and cleans in reverse dependency order. P5 defaults to an empty scenario-owned DMO and keeps every credit-consuming step blocked unless the separate billing gate is present:

```bash
D360_LIVE_MUTATIONS=1 \
  node scripts/live-verify-all.mjs --org "$D360_LIVE_ORG" --scenario p5
```

Billable P5 actions require the additional credit acknowledgement:

```bash
D360_LIVE_MUTATIONS=1 D360_LIVE_BILLABLE=1 \
  node scripts/live-verify-all.mjs --org "$D360_LIVE_ORG" --scenario p5
```

For a bounded generic rerun, name every approved paid command explicitly. The
harness refuses a broad `--billable` run, executes only those commands and their
list dependencies, records each paid attempt before dispatch, and tries at most
one eligible resource per command. A retry requires a new approval and a new
ledger:

```bash
D360_LIVE_MUTATIONS=1 D360_LIVE_BILLABLE=1 D360_LIVE_SHARED_DATA=1 \
  node scripts/live-verify-all.mjs --org "$D360_LIVE_ORG" \
    --mutations --billable \
    --billable-command "data360 query vector" \
    --billable-command "data360 query hybrid"
```

When no existing Data Graph is available, use the focused owned lifecycle. It
creates an empty disposable DMO and Graph, records cleanup before creation,
attempts only `data360 data-graph refresh`, and deletes both owned resources:

```bash
D360_LIVE_MUTATIONS=1 D360_LIVE_BILLABLE=1 D360_LIVE_P5_GRAPH_REFRESH_ONLY=1 \
  node scripts/live-verify-all.mjs --org "$D360_LIVE_ORG" --scenario p5
```

Use the same focused pattern for Segment, Identity Resolution, or Data Kit
verification. These modes exclude unrelated P5 families and retain the normal
ownership, billing, and cleanup gates:

```bash
# One disposable DMO and Segment; publish is the only billed call.
D360_LIVE_MUTATIONS=1 D360_LIVE_BILLABLE=1 D360_LIVE_P5_SEGMENT_ONLY=1 \
  node scripts/live-verify-all.mjs --org "$D360_LIVE_ORG" --scenario p5

# One disposable Identity Resolution ruleset cloned from declarative test-org metadata.
D360_LIVE_MUTATIONS=1 D360_LIVE_BILLABLE=1 D360_LIVE_P5_IDENTITY_ONLY=1 \
  node scripts/live-verify-all.mjs --org "$D360_LIVE_ORG" --scenario p5

# One disposable DLO and Data Kit; this mode is non-billable.
D360_LIVE_MUTATIONS=1 D360_LIVE_DATA_KIT_MUTATIONS=1 D360_LIVE_P5_DATA_KIT_ONLY=1 \
  node scripts/live-verify-all.mjs --org "$D360_LIVE_ORG" --scenario p5
```

An isolated scenario can still fail before its target action when the org
rejects a create definition. Count that as attempted contract evidence only;
do not mutate a retained resource or weaken cleanup to manufacture a success.

For the final non-billable command-surface audit, run only collision-resistant
missing-resource and invalid-definition probes. These commands authenticate to
the live org but do not create a retained resource:

```bash
D360_LIVE_MUTATIONS=1 D360_LIVE_CONTRACT_PROBES_ONLY=1 \
  node scripts/live-verify-all.mjs --org "$D360_LIVE_ORG" --scenario p5
```

Billable ingestion is a separate workflow and requires both gates plus owner-approved disposable inputs:

```bash
D360_LIVE_MUTATIONS=1 D360_LIVE_BILLABLE=1 scripts/smoke-p3.sh
```

Never use shared or customer data to prove a lifecycle. A unique resource name proves scenario ownership only when the scenario created that resource; it does not establish ownership of an attached source object or its records.

## Evidence and cleanup

- Register cleanup before every create.
- Use collision-resistant disposable names.
- Keep raw captures outside the repository.
- Retain only minimal scrubbed response shapes needed by the test.
- Remove tokens, auth URLs, domains, usernames, tenant/org IDs, resource IDs, record values, and customer identifiers.
- Treat an empty collection as collection-shape evidence only.
- Treat a failed create plus confirmed absence as cleanup evidence, not mutation success.
- Stop creating resources when cleanup is unresolved; preserve the ignored ledger for the owner.

Run the fixture and release scans before committing evidence:

```bash
yarn fixtures:scan
yarn secrets:scan
```

## CI setup

Store live auth material as a masked secret scoped to a protected live-test environment. Require reviewer approval for live jobs. Keep mutation and billing gates absent from the scheduled read-only workflow and enable them only in separately approved jobs.

Never enable shell tracing around authentication, upload raw captures or auth exports, or persist the Salesforce CLI state directory as an artifact. Revoke exposed credentials before attempting repository-history cleanup.

## Forbidden data

Tracked files, npm packages, examples, issues, reviews, logs, fixtures, and CI artifacts must not contain plaintext credentials, access or refresh tokens, auth URLs, frontdoor/session URLs, tenant JWTs, consumer keys, passwords, real usernames, org or tenant identifiers/domains, customer data, or unnecessary live resource identifiers.

If a value might grant access or identify a tenant, keep it in the approved secret manager and ask the security owner before sharing it.
