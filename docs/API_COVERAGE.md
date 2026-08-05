# API and workflow coverage

This document answers two different questions that must not be collapsed into one:

1. Which workflows have a dedicated, opinionated `sf data360 ...` command?
2. Which Data 360 HTTP operations can an advanced user call through the raw request escape hatch?

Status snapshot: **2026-07-29 PDT**.

## Current result

- The oclif manifest contains **135 dedicated commands**. All 135 have unit metadata, mock integration coverage, schemas, messages, and generated help.
- **102 of 135** commands have successful, scrubbed, command-specific live-org evidence. An empty live column in [`VERIFICATION.md`](../VERIFICATION.md) means that no qualifying successful public fixture exists for that exact command; it does not prove the command was never attempted.
- A point-in-time manual review of the official Data 360 Connect REST API v67 OpenAPI document observed **approximately 201 operations**. The source artifact is not redistributed or pinned in this repository, so that number is context—not a repository-enforced release metric. An API-operation count is not a target command count: one CLI command can make several requests, and several lifecycle commands can correspond to one templated API path.
- `sf data360 api request` is the raw Core/Connect escape hatch, and `--direct` targets an authorized tenant-plane path. It extends reach while a dedicated wrapper is absent; it does **not** provide the wrapper's typed flags, schema, confirmation policy, pagination, retry/job semantics, or live-verification claim.

The honest conclusion is therefore: the plugin covers the highest-value query, ingestion, data-foundation, activation, profile, and selected P6 workflows with a dedicated surface, but it does **not** wrap every v67 operation. Raw request reach must not be described as dedicated or tested coverage.

## Reproducing the operation audit

This checkout does not contain an official v67 OpenAPI file or a generated operation inventory. That omission avoids republishing a Salesforce-owned specification without an established redistribution and update policy, but it means the approximate count above cannot be reconstructed from the checkout alone.

To reproduce the mechanical part of the audit from a source checkout, obtain the official v67 OpenAPI document from the [Salesforce specification page](https://developer.salesforce.com/docs/data/connectapi/references/spec), retain it as JSON outside the repository, and run:

```bash
yarn api:operations:audit ./official-v67-openapi.json --output ./data360-v67-operations.json
```

The generated inventory contains the input SHA-256, operation count, tag totals, and a sorted method/path/operation-id list. Record both the hash and retrieval date with any future coverage decision. The script performs no network fetch and cannot establish that two separately downloaded artifacts are the same version; until Salesforce provides an immutable artifact URL or the project approves a pinned copy, describe the ~201 total as an independently reviewed estimate rather than a reproducible release assertion.

## Dedicated command surface

Counts below come from the generated oclif manifest. “Mock-verified” means real oclif parsing plus the mocked HTTP boundary; it does not mean the corresponding org capability has command-level live evidence.

| Slice                                                | Dedicated commands | Evidence and boundary                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | -----------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup, query, metadata, doctor, open, raw API, token |                 13 | ECA setup, Query SQL v3, typed SQL parameters, query settings, workload names, async continuation, REPL, metadata reads, diagnostics, and raw Core/Direct requests. Vector and hybrid SQL builders remain live-dialect-gated.                                                                                                     |
| Streaming and bulk ingestion                         |                  7 | Mock lifecycle, byte caps, streaming/backpressure, resume/report/cancel, and retained live ingestion evidence. Ingestion remains billable and independently gated.                                                                                                                                                                |
| P4 data foundation                                   |                 51 | Connection, connector, data stream, DLO, DMO and relationships, mapping, transform, and data space. A disposable foundation run passed 33 steps, intentionally safety-blocked 4, ran 0 billable steps, and completed all 4 registered cleanup actions.                                                                            |
| P5 outcome families                                  |                 46 | Identity resolution, calculated insights, segments, activations and targets, search indexes, data graphs, and profiles. The two P5 query builders are counted in the first row. Query, calculated-insight run, and data-graph refresh now have live evidence; publication and several prerequisite-heavy journeys remain partial. |
| Retriever and Document AI reads                      |                  4 | Retriever list/get/configuration list and `docai describe` have successful live fixtures.                                                                                                                                                                                                                                         |
| P6 collection reads                                  |                  4 | Document AI configuration, semantic-model, Data Action, and Data Action target list commands have dedicated live fixtures. Empty collections validate only their list envelopes.                                                                                                                                                  |
| Data Kit                                             |                 10 | Official v67 contracts and synthetic fixtures cover list, available components, manifest, create, update, delete, deploy, undeploy, component dependencies, and component status. Eight commands are live-verified; two remain org- or platform-blocked.                                                                          |
| **Total**                                            |            **135** | **135 unit/mock; 102 successful command-specific live fixtures.**                                                                                                                                                                                                                                                                 |

The remaining 33 undated commands broadly fall into three review dispositions:

| Disposition                         | Why no successful public fixture exists                                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing owned prerequisites         | The reviewed org had no disposable connection, data stream, transform, activation target, deployed Data Kit, or fully mapped identity-resolution input to use. |
| Resource or platform limitation     | The required capability was unavailable, Direct token exchange was unavailable, or the bounded endpoint returned a platform error.                             |
| Credit-gated or data-reading action | The operation can run compute, publish, refresh, ingest, or read customer data and therefore requires separate billing and data-use approval.                  |

The repository intentionally does not assign numeric subcounts to these dispositions because a command can satisfy more than one blocker. The command-level success ledger remains the release source of truth.

### Data Kit boundary

The dedicated Data Kit family follows the v67 specification rather than the older roadmap assumptions:

- `GET`/`POST /ssot/data-kits`
- `GET /ssot/data-kits/available-components`
- `PATCH`/`DELETE`/deploy `POST /ssot/data-kits/{dataKitDevName}`
- `POST /ssot/data-kits/{dataKitDevName}/undeploy`
- `GET /ssot/datakit/{dataKitDevName}/manifest`
- component dependency and deployment-status reads

The specification defines neither a get-single Data Kit operation nor a deployment-job status resource. Deploy/undeploy can return a job ID, but continuation is through component status, not an invented job command.

`data-kit list`, `data-kit available`, `data-kit component status`, `data-kit manifest`, `data-kit create`, `data-kit update`, `data-kit delete`, and `data-kit undeploy` have successful scrubbed live fixtures (latest evidence 2026-07-29). Create, update, and delete used an exact-name disposable kit and verified absence after cleanup. Deploy was rejected because a local kit cannot be deployed in the same org, and component dependencies reached a platform error. Those two commands remain undated.

## Live evidence snapshot

| Evidence               | Result                                                                                                                                                         | What it proves                                                                                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification matrix    | 102 of 135 commands have successful command-specific live fixtures                                                                                             | Those exact command/response paths ran successfully on an authorized Data 360 org on the recorded date. It does not promote related commands automatically.                                                                                                                 |
| Disposable P4 scenario | 33 passed; 4 intentionally safety-blocked; 0 billable                                                                                                          | The tested foundation reads and disposable DLO/DMO/mapping/relationship lifecycle worked, including mapping update/delete. Safety blocks were expected policy outcomes, not failed API calls.                                                                               |
| P4 cleanup             | 4 of 4 registered cleanup actions passed                                                                                                                       | Scenario-owned relationship, DMO, DLO, and mapping resources were removed. Retained shared ingestion assets were explicitly outside scenario ownership.                                                                                                                     |
| Data-stream mutation   | No qualifying successful public fixture is recorded                                                                                                            | Data-stream mutations remain without live-success dates. Detailed attempts and environment evidence are intentionally not published.                                                                                                                                        |
| Direct Query API v3    | Bounded raw query transport has successful scrubbed evidence                                                                                                   | Confirms the Direct route and token exchange; it does not create a separate dedicated-query live date.                                                                                                                                                                      |
| Connect Query options  | Parameters, settings, and workload metadata have successful command-level evidence                                                                             | The response-normalization edge is covered by regression tests.                                                                                                                                                                                                             |
| P6 verified reads      | Semantic-model, Data Action/target, and Document AI collection reads have command-level evidence                                                               | Empty lists validate only their collection envelopes, not detail or mutation shapes.                                                                                                                                                                                        |
| Disposable P5 scenario | 27 passed; 20 intentionally or prerequisite-blocked; 3 bounded failures; 3 of 4 billable families succeeded                                                    | Query, calculated-insight run, and data-graph refresh succeeded. Segment publication was accepted but exceeded the five-minute wait; search-index config returned not found; one insight read hit an eventual-consistency race. All four registered resources were removed. |
| Reviewed mutations     | Data-space update/member set; Data Kit create/update/delete; calculated-insight, segment, search-index, and data-graph lifecycle operations have live evidence | These exact metadata operations succeeded with preflight ownership checks and cleanup. Calculated-insight run and data-graph refresh also have command-specific live evidence; segment publication and data-graph record reads remain undated.                              |
| Data Kit               | Eight commands have successful scrubbed live fixtures (latest evidence 2026-07-29)                                                                             | List, available-component, component-status, manifest, create, update, delete, and undeploy are live-verified. Deploy and dependencies remain undated.                                                                                                                      |

Additional command-specific successes are reflected only in the generated verification matrix. Public documentation intentionally omits raw rows, resource identifiers, failure logs, local journals, and environment-specific details.

Live evidence is intentionally command-specific. A family list returning 200 does not validate create/update/delete, a 204 is normalized only for operations whose contract permits it, and an empty list cannot define detail columns or mutation bodies.

## Explicitly unwrapped or partial areas

The following areas are not silently counted as “covered.” Users can try documented Core/Connect operations through `data360 api request`, subject to org permissions and payload requirements, but these areas lack a complete dedicated and live-verified CLI contract.

| Area                                          | Current state                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine learning / Einstein Studio            | Broad v67 family remains backlog. Retriever reads are the only dedicated subset; retriever mutations are not wrapped.                                               |
| Clean Rooms                                   | No dedicated commands.                                                                                                                                              |
| Data Actions and targets                      | Dedicated list commands are live-verified; filters, detail operations, and mutation bodies remain unwrapped or raw-only.                                            |
| Semantic models and semantic query            | Dedicated model-list is live-verified; detail/authoring/query operations remain unwrapped. An empty recorded collection does not validate those shapes.             |
| Document AI                                   | `docai describe` and configuration list are dedicated and live-verified. Global configuration, configuration CRUD, extraction, and run operations remain unwrapped. |
| Consent                                       | No dedicated commands; paths and destructive semantics remain verification-gated.                                                                                   |
| Remaining identity/insight/segment operations | Identity-resolution publish, calculated-insight report/validate/enable/disable, and segment members remain excluded.                                                |
| Remaining search/metadata/graph operations    | Search-index process history/report, metadata search, and unverified graph variants remain excluded.                                                                |
| Connection/transform/DMO long tail            | The CLI wraps the reviewed workflows, not every operation under the large v67 Connections, Transforms, or Data Model Objects tags.                                  |
| Eventing and personalization                  | No dedicated commands; backlog pending public, source-verified contracts and demand.                                                                                |
| Data shares / zero-copy and consumption       | No reviewed public CRUD or consumption/wallet API was established for this release; recheck each API version.                                                       |

The v67 spec's largest tags include Machine Learning, Connections, Clean Rooms, Data Model Objects, Transforms, Data Kits, Document AI, and Segments. Tag totals are useful for gap discovery, but they are not interchangeable with user workflows or CLI command counts.

## Workflow assessment

The public verification ledger keeps mock and exact command-level live evidence separate. It does not turn mock coverage or a sibling command's live date into an end-to-end workflow claim. Today:

- smart mapping has the strongest disposable end-to-end P4 evidence;
- CRM-to-activation, external-data-to-activation, transforms, identity resolution, profile reads, ad-hoc query, monitoring, and cost controls are partial at the full-journey evidence bar;
- Eight Data Kit commands are live-verified, but deploy remains contract/mock-only because the reviewed org had no eligible owned promotion target; and
- ML, lineage, and consent remain explicit gaps or org/platform-gated work.

## Source and freshness policy

API contracts in this release were reconciled against primary sources:

- [Data 360 Connect REST API specification](https://developer.salesforce.com/docs/data/connectapi/references/spec)
- [Data 360 Query API overview](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-queryservices-overview.html)
- [Data 360 Query use case](https://developer.salesforce.com/docs/data/connectapi/guide/query-use-case.html)
- [Data Kit deploy payloads](https://developer.salesforce.com/docs/data/connectapi/guide/deploy-data-kit-payloads.html)
- [Semantic Layer Connect API quick start](https://developer.salesforce.com/docs/data/semantic-layer/guide/quick-start-connect-api.html)
- [Hosted Data 360 MCP reference](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/data360-mcp.html)
- [Salesforce CLI design guidelines](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/design-guidelines.html)
- [Salesforce CLI flag guidelines](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/flags.html)
- [Salesforce CLI message-writing guidelines](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/messages-writing-guidelines.html)
- [Salesforce CLI plugin testing guidance](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/test-plugin.html)
- [Current Salesforce CLI plugin template](https://github.com/salesforcecli/plugin-template-sf)

## Release interpretation

This coverage and the green strict gate are appropriate for a reviewed `0.x` beta. They are not a GA claim. The packaged [REPL checklist](REPL_CHECKLIST.md) has digest-backed live evidence retained in the source repository; GA still requires the live threshold and any broader manual checks in scope.
