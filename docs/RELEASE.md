# Release guide

A release is publishable only when every applicable item below passes on the exact release commit and packed artifact.

## One-time owner setup

- [ ] Make `dsouza-anush/sf-plugin-data360` public only after the private review is approved.
- [ ] Confirm that `sf-plugin-data360` is still available on npm, claim it with the intended npm account, and require two-factor authentication for account changes.
- [ ] Create a GitHub environment named `npm` and require owner approval for deployments from `.github/workflows/publish.yml`.
- [ ] Configure npm trusted publishing for GitHub Actions with owner `dsouza-anush`, repository `sf-plugin-data360`, workflow `publish.yml`, environment `npm`, and `npm publish` permission. Do not add a long-lived npm write token to GitHub.
- [ ] Enable GitHub private vulnerability reporting and update [SECURITY.md](../SECURITY.md) if the approved route differs.
- [ ] Add branch or repository rules that require the `test` workflow on `main`, block force pushes, and require the branch to be current before merge.
- [ ] Set the repository description, website, and topics, and confirm Issues are enabled.

The publish workflow uses npm's OIDC trusted-publisher flow and publishes only the tarball produced from the GitHub release tag. npm provenance is generated when both the repository and package are public.

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

## Cut a release

1. Update `package.json` and `npm-shrinkwrap.json` to the same version, move the matching changelog section from **Unreleased** to its release date, and regenerate all artifacts with `yarn build`.
2. Run `yarn release:check` from a clean checkout. Review `git diff`, the packed file list, and the generated command and verification counts.
3. Merge the reviewed change only after every required GitHub check is green.
4. Create and push the matching annotated tag, for example `v0.1.0`. Do not move or reuse a published tag.
5. Draft a GitHub release from that tag. Include the verification boundary, known limitations, install command, release commit, and upgrade or rollback notes. Mark pre-1.0 builds as prereleases.
6. Publish the GitHub release. `.github/workflows/publish.yml` reruns the complete release gate, packs the exact tag, uploads the tarball and SHA-256 digest, and publishes that same tarball to npm through OIDC. Stable versions use npm's `latest` dist-tag; SemVer prereleases use their prerelease identifier, such as `beta`.
7. Confirm the workflow is green, the GitHub artifact digest matches, and `npm view sf-plugin-data360@0.1.0` reports the expected repository, engines, and dependencies.
8. From a clean environment, run `sf plugins install sf-plugin-data360@0.1.0`, `sf data360 --help`, `sf data360 query --help`, and a read-only `sf data360 doctor --target-org <approved-org>` check.

If a release is bad, stop promotion, mark the GitHub release accordingly, deprecate the npm version with a replacement message, and publish a fixed patch. Do not delete Git tags or rely on npm unpublish as a normal rollback.

## Publisher-owned prerequisites

Before publishing, the release owner must confirm npm ownership, the support and security-reporting routes, the trusted-publisher registration, GitHub environment protection, provenance policy, and the release-approval record. These values cannot be inferred safely from source code.

After those decisions are configured, publish only from the exact clean commit that passed CI and `yarn release:check`. The checked-in publish workflow is the supported path; a local `npm publish` is reserved for documented recovery and must preserve the same tag, artifact, digest, and approval record.

This repository is pre-1.0. Empty live-verification cells can be accepted only for an explicitly reviewed beta; they block a claim of GA verification.
