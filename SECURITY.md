# Security

## Reporting a vulnerability

Do not report a suspected vulnerability in a public issue, discussion, pull request, fixture, or chat channel.

Use the first private route available:

1. When this repository is hosted on GitHub and **Report a vulnerability** is available on its **Security** page, open a private vulnerability report there. This keeps the report and any draft advisory private to the repository security team.
2. If GitHub private vulnerability reporting is unavailable, contact a repository maintainer through an existing, authenticated private channel approved for this project and ask them to establish a restricted security thread. If the first contact is not already restricted to the response team, share only a request for a private reporting route—not vulnerability details.

This policy intentionally does not publish an unverified email address or external intake URL. Before inviting external beta or public use, maintainers must enable GitHub private vulnerability reporting or document an approved private maintainer contact here.

Include the following after a private channel is established:

- the affected plugin version or commit, Salesforce CLI and Node.js versions, and operating system;
- the security impact and the authorization boundary involved;
- minimal reproduction steps using synthetic data in an org you are authorized to test;
- expected and actual behavior, including scrubbed error names, codes, statuses, and exit codes; and
- a proposed mitigation, if known.

Do not include access or refresh tokens, auth URLs, consumer keys, passwords, Salesforce auth files, authorization headers, tenant JWTs, real usernames or email addresses, org or tenant IDs/domains, customer data, or unnecessary Salesforce record/resource identifiers. Prefer a minimal synthetic proof over raw doctor output, raw API captures, debug logs, or exported fixtures. If diagnostic output is necessary, apply the redaction rules in this policy before sharing it in the restricted channel.

Maintainers will confirm the private coordination route, assess impact and affected versions, coordinate remediation and regression tests, and agree on disclosure timing with the reporter. No response-time or historical-version support commitment is implied by this pre-1.0 policy.

## Authorized testing

Test only systems, orgs, users, and data you own or are explicitly authorized to assess. Use dedicated non-production environments and synthetic data. Do not perform denial-of-service testing, access another tenant's data, bypass mutation or billing gates, or run destructive or credit-consuming operations without explicit approval. Stop testing and report privately if a response crosses an authorization or tenant boundary.

## Credential or data exposure

If a credential or sensitive tenant/customer value reaches Git, an issue, logs, or an artifact, removal is not sufficient. Revoke or rotate it first, notify the project security owner through the private process above, preserve only approved incident evidence, remove the value from history and artifacts, and review access logs.

## Security boundaries

Security-sensitive areas include Salesforce org authentication, Direct API token exchange and caching, proxy and redirect behavior, raw API URL/header controls, fixture scrubbing, local file permissions, JSON/error redaction, and destructive or billable-operation gates.

The plugin consumes Salesforce CLI org authentication and does not copy the Core org access token into its own cache. Direct API commands exchange that session for a short-lived Data 360 tenant JWT and, by default, cache the JWT by username in `~/.sf/data360-token-cache.json`. Salesforce Core encrypts the cached value with its keychain-backed crypto, the file is set to mode `0600`, and entries are treated as expired five minutes before server expiry. Use `--no-token-cache` to bypass persistent token-cache reads, decrypts, writes, and invalidation. Query cache files contain only query IDs, usernames, API versions, data-space names, and output preferences; they are also written with mode `0600`.

Fixture and test rules:

- Run the scrubber before committing captured responses.
- Never commit org access tokens, tenant JWTs, credentials, or real customer data.
- Run `yarn secrets:scan` before review. The release gate inspects every tracked working-tree file, every staged index blob, and every blob reachable from `HEAD`; pass `--ref <git-ref>` through `node scripts/release-secret-scan.mjs` when auditing another release ref. Findings omit matched values. A failed or unavailable Git read fails the gate.
- Run `yarn public:check` for every change and `yarn public:check:history` on the public release branch. Ignoring or deleting restricted material does not remove it from Git history.
- Source-repository maintainers must also follow the source-only `LIVE_TESTING.md` runbook for environment ownership, CI secret handling, credential revocation, and cleanup.
- `SF_DATA360_TENANT_URL` is accepted only in test processes and only for loopback hosts.
- Raw API requests reject external URLs, path traversal, and authorization/host/content-length header overrides.
