# Documentation map

Start with [Get started with the experimental Data 360 CLI plugin](GETTING_STARTED.md). It is the review draft for the public beta experience: release boundary, installation, authentication, a safe read-only workflow, automation behavior, risk controls, and troubleshooting.

## User documentation shipped with the plugin

| Document                                      | Purpose                                                                 | Authority                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Getting started](GETTING_STARTED.md)         | Experimental status, first run, workflow map, automation, and safety    | Curated user guide; beta counts must match the generated evidence before release.  |
| [Installation](INSTALLATION.md)               | Source, published-package, unsigned-plugin, update, and uninstall paths | Distribution guide; package placeholders remain until ownership is decided.        |
| [External Client App](EXTERNAL_CLIENT_APP.md) | Direct API OAuth scopes, setup, authorization, CI, and troubleshooting  | Direct-auth guide; use `sf org login web --help` for installed CLI flags.          |
| [Command reference](COMMAND_REFERENCE.md)     | Every command, argument, flag, and rendered example                     | Generated from the oclif manifest; do not edit by hand.                            |
| [API coverage](API_COVERAGE.md)               | Dedicated commands, raw reach, live evidence, and explicit backlog      | Curated coverage boundary reconciled against the manifest and verification ledger. |
| [CLI contract](CLI_CONTRACT.md)               | Command design, automation, safety, and compatibility guarantees        | Public contributor and user contract enforced by repository gates.                 |
| [Release guide](RELEASE.md)                   | Public-release prerequisites and artifact verification                  | Maintainer checklist; every item is required for a public release.                 |
| [REPL checklist](REPL_CHECKLIST.md)           | Terminal behavior that requires human review                            | Manual acceptance contract.                                                        |
| [Examples](../examples/README.md)             | Curated input files and payload provenance                              | Use only examples marked as curated.                                               |
| [Verification](../VERIFICATION.md)            | Unit, mock, and exact live-verification dates                           | Generated command-level source of truth; do not infer sibling coverage.            |
| [Security](../SECURITY.md)                    | Reporting and credential-handling policy                                | Public security contract.                                                          |

The npm package uses an explicit file allowlist. Contributor and live-testing guides remain public-source-only; restricted working material is excluded from both the public source boundary and the package.

## Restricted local material

Maintainer plans, review history, environment details, raw evidence, testbed reports, datasets, and reference checkouts belong under the ignored `internal/` boundary or in an approved access-controlled system. They must not be linked or copied into public source or the npm package. Secrets always belong in an approved secret manager, not `internal/`.

## Experimental release documentation checklist

- [ ] The beta warning, unsupported status, and non-production recommendation are acceptable for the intended cohort.
- [ ] The package owner, final package name, exact version, repository URLs, and support channel are decided before replacing any distribution placeholders.
- [ ] `GETTING_STARTED.md`, `README.md`, `API_COVERAGE.md`, `COMMAND_REFERENCE.md`, and `VERIFICATION.md` agree on command and live-verification counts.
- [ ] The generated command reference and verification matrix are fresh from the release candidate.
- [ ] The read-only getting-started commands work from the exact packed artifact in an approved org.
- [ ] ECA setup and reauthorization wording matches the approved OAuth policy; the manual login-to-doctor residual is complete or explicitly accepted.
- [ ] Destructive, noninteractive, billable, Data Kit, and raw-request boundaries are prominent enough for the beta audience.
- [ ] The package-content gate proves that `GETTING_STARTED.md` ships and source-only evidence does not.
- [ ] Release notes describe known gaps and avoid converting mock or family-level evidence into a live-support claim.
