# Public release guide

A release is publishable only when every applicable item below passes on the exact release commit and packed artifact.

## Repository boundary

- `yarn public:check` passes for the working tree.
- `yarn public:check:history` passes on the public release branch. If earlier commits contain restricted material, publish from a reviewed clean-history branch; do not treat deletion or `.gitignore` as history cleanup.
- Local plans, reviews, raw evidence, reports, datasets, environment details, and reference checkouts stay under the ignored `internal/` boundary or an approved restricted system.
- Repository owner, remote URLs, support route, package ownership, and private vulnerability reporting are configured and reflected in public metadata.

## Quality and security

- `yarn release:check` passes with the supported Node versions and the lockfiles are unchanged. This is the single local release-candidate gate; `yarn test:prepush` is an equivalent compatibility entry point.
- `yarn secrets:scan`, `yarn fixtures:scan`, and `yarn contract:check` pass against the release ref.
- `yarn audit:production` reports no high or critical production findings, authenticated redirects remain disabled, sensitive errors are redacted, and destructive or billable actions fail closed.
- Generated schemas, command reference, manifest, snapshot, criteria, and verification matrix are fresh.

## Distribution

- Pack the exact candidate and run `yarn test:package <tarball>` through the pinned Salesforce CLI.
- Inspect the tarball allowlist, file modes, npm shrinkwrap, licenses, notices, examples, and public documentation.
- Verify install, topic help, representative command help, update, and uninstall instructions from a clean environment.
- Record the release commit, package digest, test results, known limitations, and rollback procedure in the restricted release record.

## Publisher-owned prerequisites

Before publishing, the release owner must resolve the final npm package name and owner, repository and support URLs, security-reporting route, npm trusted-publisher or token policy, provenance/signing policy, and release-approval record. These values cannot be inferred safely from source code and must not be replaced with placeholders in a public package.

After those decisions are configured, publish only from the exact clean commit that passed CI and `yarn release:check`. Use `yarn pack --filename sf-plugin-data360.tgz`, record its SHA-256 digest, rerun `yarn test:package sf-plugin-data360.tgz`, and publish that reviewed candidate according to the owner's access and provenance policy.

This repository is pre-1.0. Empty live-verification cells can be accepted only for an explicitly reviewed beta; they block a claim of GA verification.
