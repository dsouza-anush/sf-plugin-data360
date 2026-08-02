# Changelog

## 0.1.0-beta.1 - 2026-08-02

- Correct the generated verification narrative to reflect successful live-org evidence for all ten Data Kit commands.

## 0.1.0-beta.0 - 2026-08-02

- Add the P0 Salesforce CLI plugin foundation, typed Connect transport, retries, pagination, registry skeleton, fixtures, and contract gates.
- Add P1 Query SQL submit/resume/results/cancel commands.
- Add metadata list/get, doctor, open, and raw API request commands.
- Add P2 Direct token exchange, keychain-encrypted cache, tenant client, token display, and `api request --direct`.
- Activate doctor exchange, Direct metadata, and scope checks while keeping core-only use available.
- Add the P2 Query SQL REPL with multiline statements, XDG history, `\q`, `\dt`, `\d`, and `\f`.
- Retain the reviewed custom ESLint/TypeScript setup; exact current `plugin-template-sf` alignment remains a future upstreamability task.
- Harden Direct tenant URL validation, protected headers, scope errors, true cache bypass, doctor failures, and REPL history permissions.
- Add a real exchange-to-Direct mock NUT and a token-safe P2 live smoke script.
- Add P3 streaming and bulk ingestion, validation/delete, job report/resume/cancel, byte-bounded splitters, and family-neutral job progress.
- Add synthetic ingestion fixtures and a doubly gated live ingestion smoke script; live verification remains blocked on connector and credit approval.
- Harden P3 with decimal API limits, bounded streaming uploads, concurrent job-cache locking, delete confirmations, validation reports, job recovery hints, stateful Fastify lifecycle coverage, and a generated 151 MB gate.
- Add 51 P4 data-foundation commands with fixture-driven registry contracts and stateful command mock coverage.
- Add P5 identity, insight, segment, activation, search, graph, profile, vector, and hybrid command families.
- Make Salesforce Core message bundles the source of truth and enforce scoped inheritance/message lint rules.
- Add clean-build pre-push gates, official oclif manifest generation, nested topic descriptions, and dynamic verification of every shipped command.
- Complete the Query REPL meta-command set and add a startup performance budget.
- Add live-recorded P6 retriever reads and Document AI capability description; keep all unrecorded P6 operations excluded.
- Add the ten Connect API v67 Data Kit commands with exact routes, payload validation, confirmation boundaries, generated help, copyable examples, and synthetic contract fixtures.
- Live-verify eight Data Kit commands plus data-space membership/update, segment update, and calculated-insight run with scrubbed command-specific evidence and cleanup checks.
- Harden pagination termination, Data Kit component selection, data-space member payload validation, mutable-resource name resolution, and live-evidence identifier scrubbing.
- Add Query SQL parameter, query-settings, workload, terminal-at-submit, empty-result, resume, and Direct Query v3 compatibility fixes.
- Add request-scoped enterprise proxy support, versioned and structurally validated caches, fixture-secret scanning, and Node.js 22/24 release gates.
- Add generated coverage and command references, installation and External Client App guides, package smoke tests, and release-readiness evidence.
- Add disposable P4/P5/P6 live verification scenarios with bounded mutations, billing controls, cleanup ledgers, and sanitized evidence capture.
- Add live-verified list commands for Document AI configurations, semantic models, Data Actions, and Data Action targets; keep empty-collection detail and mutation shapes unwrapped.
- Make contributor Git-hook setup explicit instead of publishing a `prepare` lifecycle, keeping non-interactive npm 11 and Salesforce CLI installs side-effect-free.
- Add a single `release:check` candidate gate and verify Salesforce-style action-first flexible-taxonomy help alongside canonical command IDs.
- Add Data 360 branding, a public architecture guide, release badges, and a task-oriented documentation map modeled on established oclif repositories.
- Add an npm OIDC trusted-publishing workflow with safe stable/prerelease dist-tags and an owner-facing GitHub/npm release checklist.
- Pin `@oclif/core` to the Salesforce plugin-core version so clean frozen installs compile with one portable oclif type graph.
- Keep the packaged oclif dependency lock synchronized with Yarn after every package lifecycle.
- Keep noninteractive Query SQL examples and subprocess verification explicit about billable-operation confirmation.
- Preserve encoded opaque query IDs containing literal percent signs while retaining multi-layer traversal rejection.
- Make the release test suite portable across Windows path, permission, line-ending, and runner-performance semantics.
- Move GitHub workflows to the current Node 24-based official action majors.
- Document the one-time npm prerelease bootstrap required before OIDC trusted publishing can be configured.
- Await streamed query-output file closure before atomic rename or failure cleanup.
- Load Salesforce's official `@salesforce/plugin-data-code-extension` 1.3.2 as a pinned child plugin, expose all ten
  canonical `sf data-code-extension` commands from the same installation, and add prerequisite and workflow documentation.
- Verify disposable Code Extension init, scan, run, zip, and enabled-org deployment workflows for scripts and functions;
  document the upstream Python SDK REST-version compatibility boundary.
- Send the required empty JSON body when starting a Data 360 transform, with command and HTTP regression coverage.

### Known limitations

- `data-space member unset` remains excluded because the DELETE endpoint is unverified and has no recorded live fixture.
- Transform pre-create validation remains excluded because `/data-transforms-validation` is unverified.
