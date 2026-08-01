## Outcome

<!-- Lead with the user-visible result and the problem it solves. -->

## Change class

- [ ] Bug fix
- [ ] New or changed command/API coverage
- [ ] JSON or schema contract change
- [ ] Documentation only
- [ ] Test or fixture only
- [ ] Build, dependency, or release infrastructure

## Scope and source of truth

<!-- Link the plan item, issue, authoritative Salesforce API/CLI documentation, and API version. Identify assumptions and unknowns. A raw 2xx response alone is not a complete command contract. -->

- Plan/issue:
- Salesforce contract and API version:
- Commands and shared modules affected:
- Compatibility or migration notes:

## CLI contract review

- [ ] Command IDs, topics, aliases, flags, defaults, relationships, and exit codes follow Salesforce CLI and oclif conventions.
- [ ] Human, `--json`, CSV/other machine output, and `--no-prompt` behavior are covered where applicable.
- [ ] Messages contain actionable errors and at least two realistic, non-sensitive examples for each changed command.
- [ ] JSON output remains compatible, or the intentional breaking change and migration path are documented.
- [ ] Generated schemas, command snapshot, manifest, command reference, criteria, and verification matrix are current.
- [ ] Not applicable; this change has no user-visible CLI contract (explain above).

## Verification

Record the exact command, exit code, and result. Do not mark a gate as passed if it was not run.

| Gate                  | Command                               | Exit code and result |
| --------------------- | ------------------------------------- | -------------------- |
| Focused unit/mock     | `yarn verify:command <command-id>`    |                      |
| Full release parity   | `yarn test:prepush`                   |                      |
| Package install smoke | included in pre-push gate, or explain |                      |
| Other                 |                                       |                      |

### Live evidence, if applicable

<!--
Use only an authorized test environment. Give the environment class and verification date, never its alias, username, org/tenant ID, domain, or real resource IDs.

Before pasting output, remove credentials, auth URLs, authorization headers, usernames, emails, org/tenant identifiers and domains, customer data, record/resource IDs, and sensitive correlation IDs. Never attach raw live captures, Salesforce auth files, debug logs, ignored ledgers, or local environment files.
-->

- Environment class and observation date:
- Read-only, mutation, or billable:
- Approval reference for mutation/billing (private reference only; do not paste approval contents):
- Disposable resources and verified cleanup outcome:
- Fixture provenance: live-scrubbed / synthetic / none

`sf data360 doctor --target-org <org-alias> --json` (scrubbed; include exit code):

```json

```

Changed command with `--json` (scrubbed; include exit code):

```json

```

## Safety and security

- [ ] No credential, auth URL, token, tenant/org identifier or domain, username/email, customer data, or real sensitive resource identifier appears in the diff, fixtures, issue, or pasted evidence.
- [ ] Captured fixtures pass the repository scrubber and secret scan; synthetic fixtures are explicitly marked.
- [ ] Destructive operations require established confirmation/`--no-prompt` behavior and test cleanup before resource creation.
- [ ] Mutation and billing gates remain independent and fail closed.
- [ ] Raw API URL, redirect, proxy, header, file/path, cache-permission, and error-redaction boundaries were reviewed where relevant.
- [ ] Security-sensitive behavior has focused negative tests, or is not affected (explain above).

## Documentation and release notes

- [ ] User documentation, examples, help, API coverage, live-testing notes, and CHANGELOG are updated where applicable.
- [ ] Mock-only, partial-live, and fully live-verified behavior are labeled honestly.
- [ ] Known limitations and external release blockers remain explicit.

## Reviewer notes

<!-- Call out the riskiest assumption, the most important test, and anything that requires a second environment or human verification. -->
