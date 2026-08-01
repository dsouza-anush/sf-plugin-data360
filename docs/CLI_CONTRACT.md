# CLI design and automation contract

This pre-1.0 plugin follows Salesforce CLI and oclif conventions while keeping Data 360 safety boundaries explicit. `command-snapshot.json`, the generated command reference, JSON schemas, and `VERIFICATION.md` are the machine-checked sources of truth for the shipped surface.

## Command design

- Topics and commands use lowercase nouns and clear action verbs. Flags use kebab-case, standard Salesforce CLI flag names, and oclif parser relationships.
- Canonical command IDs keep the established resource-first hierarchy, such as `sf data360 connection list`. The enabled oclif flexible taxonomy also accepts Salesforce-style action-first input, such as `sf data360 list connection`; automated help smoke tests protect both forms. Documentation and scripts use the canonical form so copy-paste output stays consistent.
- Every command has a concise summary, a fuller description, at least two runnable examples, and help for every flag.
- Shared typed command bases centralize org resolution, API versions, timing, stderr status, JSON behavior, confirmation, and stable error handling.
- A dedicated command ships only after its path, method, inputs, response shape, errors, schema, fixtures, and parser behavior have explicit evidence. Unverified API shapes stay absent.

## Automation contract

- Structured commands support Salesforce CLI's global `--json` envelope. `sf data360 api request` is the documented raw-byte exception.
- Machine-readable stdout contains no progress, notices, prompts, or recovery hints. Human status and timing use stderr.
- Commands expose stable `D360_*` error names, actions, nonzero exit codes, and JSON schemas. Automation must check both the process exit code and the JSON status.
- Long-running commands print copy-paste recovery commands in human mode and return identifiers in structured output.
- CSV output follows RFC 4180 and neutralizes spreadsheet formulas. Human tables render terminal control characters visibly.

## Safety contract

- Destructive and credit-consuming operations require explicit confirmation in noninteractive and JSON contexts.
- Authenticated transports reject redirects. Raw API paths cannot escape their approved API root or override credential-bearing headers.
- Credentials and tenant-sensitive values are redacted from errors, traces, live-test state, fixtures, and package content.
- Live evidence must use an authorized non-production org, synthetic or approved test data, explicit mutation and billing gates, and registered cleanup.

Repository maintainers performing live checks must follow [LIVE_TESTING.md](../LIVE_TESTING.md).

## Compatibility and verification

Breaking command, flag, output-schema, or error-contract changes require a documented pre-1.0 migration note. Generated artifacts must remain deterministic and fresh.

Run the public contract locally:

```bash
yarn release:check
```

That candidate gate runs the source-boundary and secret checks, a clean deterministic build, generated-artifact checks, help and taxonomy smoke tests, lint and formatting, unit/mock/evaluation/coverage/security/performance suites, and a packed-plugin install/help/uninstall smoke test. Run individual scripts such as `yarn test`, `yarn test:eval`, or `yarn contract:check` while developing when a narrower feedback loop is useful.

The repository keeps unit/mock evidence separate from exact command-level live evidence. A synthetic fixture or sibling command does not establish live support.

See [Salesforce CLI plugin design guidelines](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/design-guidelines.html), [oclif command development](https://oclif.io/docs/commands/), and the [Heroku CLI style guide](https://devcenter.heroku.com/articles/cli-style-guide) for the upstream conventions behind this contract.
