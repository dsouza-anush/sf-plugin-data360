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

The package name is `sf-plugin-data360`; the public source, issue tracker, and private-vulnerability-reporting route are the GitHub repository named in `package.json`. The `publish.yml` workflow publishes from a GitHub Release by using npm trusted publishing and automatic provenance.

Before the first release, the release owner must claim the npm package, configure `dsouza-anush/sf-plugin-data360` and `publish.yml` as its trusted publisher, protect the GitHub `npm` environment with required reviewers, require two-factor authentication, and record release approval. These credentialed registry and repository settings cannot be completed from source code.

Publish only from the exact clean commit that passed CI and `yarn release:check`. Update the changelog date, create a matching `v<package-version>` tag, and publish its GitHub Release. The workflow reruns the release gate and verifies that tag, package version, and changelog agree before `npm publish`. For a local candidate, use `yarn pack --filename sf-plugin-data360.tgz`, record its SHA-256 digest, and rerun `yarn test:package sf-plugin-data360.tgz`.

This repository is pre-1.0. Empty live-verification cells can be accepted only for an explicitly reviewed beta; they block a claim of GA verification.
