# Contributing

Thanks for improving the Data 360 CLI experience. This is a pre-1.0 plugin, so changes should be small, evidence-backed, and compatible with Salesforce CLI conventions.

## Set up

Use a supported Node version and the pinned Yarn Classic release:

```bash
corepack enable
yarn install --frozen-lockfile
yarn build
yarn hooks:install
```

Read [the CLI contract](docs/CLI_CONTRACT.md), [testing guide](TESTING.md), [security policy](SECURITY.md), and the relevant generated command help before changing behavior.

## Change a command

1. Confirm the API path, method, inputs, response, and error shape from an approved source. Do not invent endpoints or promote sibling-command evidence.
2. Add or update message-file help, real oclif parser tests, synthetic fixtures, JSON schema coverage, and stable error actions.
3. Preserve JSON stdout, stderr diagnostics, confirmation, billing, redaction, pagination, and API-version contracts.
4. Regenerate deterministic artifacts with `yarn build` and verify the command with `yarn verify:command "<command-id>"`.

Never commit credentials, customer data, org or tenant identifiers, raw live captures, private plans, review notes, or environment details. Put non-public working material under the ignored `internal/` directory and keep secrets in an approved secret manager.

## Validate

```bash
yarn public:check
yarn lint
yarn format:check
yarn test
yarn test:eval
yarn test:coverage
yarn contract:check
yarn test:package
```

Live tests require explicit authorization and the independent mutation and billing gates documented in [LIVE_TESTING.md](LIVE_TESTING.md). A successful local or mock test is not live verification.

Before opening a change, include the behavior delta, compatibility impact, exact tests run, evidence provenance, and any live or environment-limited gaps. Security issues must follow [SECURITY.md](SECURITY.md), not a public issue or pull request.
