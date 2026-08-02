# Data 360 Code Extensions

`sf-plugin-data360` includes Salesforce's official
[`@salesforce/plugin-data-code-extension`](https://github.com/salesforcecli/plugin-data-code-extension)
as a pinned child CLI plugin. Installing this package therefore makes the canonical
`sf data-code-extension` command family available alongside `sf data360`. The implementation remains owned and
maintained by Salesforce; this plugin does not fork its Python, Docker, packaging, or deployment code.

The integrated version for `sf-plugin-data360` 0.1.0 is `@salesforce/plugin-data-code-extension` 1.3.2.

## Requirements

Salesforce's current Code Extension guide requires:

- Salesforce CLI 2.130.9 or later;
- Python 3.11, the `salesforce-data-customcode` Python SDK, and `pipreqs` for an applied `scan`;
- Azul Zulu OpenJDK 17;
- Docker Desktop, with the WSL 2 backend on Windows;
- a Data 360 sandbox or enabled org with the Code Extension feature turned on;
- the Data Cloud Architect permission set; and
- an org without Bring Your Own Key (BYOK), which Code Extension doesn't currently support.

Confirm the installed command family:

```shell
sf plugins
sf data-code-extension --help
python3.11 -m pip show salesforce-data-customcode
python3.11 -m pip show pipreqs
docker version
sf org display --target-org my-sandbox
```

## Command inventory

The child plugin contributes ten commands. They intentionally keep Salesforce's documented `data-code-extension`
namespace instead of adding duplicate `data360 code-extension` wrappers.

| Command                                  | Purpose                                                                          | Important flags                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `sf data-code-extension script init`     | Scaffold a batch-transform script package.                                       | `--package-dir`                                                                                            |
| `sf data-code-extension script scan`     | Update permissions, configuration, and requirements from the Python entry point. | `--entrypoint`, `--config-file`, `--dry-run`, `--no-requirements`                                          |
| `sf data-code-extension script run`      | Run a script locally against Data 360 data.                                      | `--entrypoint`, `--target-org`, `--config-file`, `--dependencies`                                          |
| `sf data-code-extension script zip`      | Build the deployable script archive.                                             | `--package-dir`, `--network`                                                                               |
| `sf data-code-extension script deploy`   | Upload the script package to a Data 360 org.                                     | `--name`, `--package-version`, `--description`, `--package-dir`, `--target-org`, `--cpu-size`, `--network` |
| `sf data-code-extension function init`   | Scaffold a search-index chunking function package.                               | `--package-dir`, `--use-in-feature SearchIndexChunking`                                                    |
| `sf data-code-extension function scan`   | Update function configuration and requirements from the Python entry point.      | `--entrypoint`, `--config-file`, `--dry-run`, `--no-requirements`                                          |
| `sf data-code-extension function run`    | Run a chunking function locally with a test payload.                             | `--entrypoint`, `--test-with`, `--target-org`, `--config-file`, `--dependencies`                           |
| `sf data-code-extension function zip`    | Build the deployable function archive.                                           | `--package-dir`, `--network`                                                                               |
| `sf data-code-extension function deploy` | Upload the function package to a Data 360 org.                                   | `--name`, `--package-version`, `--description`, `--package-dir`, `--target-org`, `--cpu-size`, `--network` |

Run `sf data-code-extension <script|function> <command> --help` for the installed version's complete flag contract.

## Script workflow

Scripts execute as batch data transforms. Start in a disposable project directory:

```shell
sf data-code-extension script init --package-dir ./my-script
cd my-script
sf data-code-extension script scan --entrypoint ./payload/entrypoint.py --dry-run
sf data-code-extension script scan --entrypoint ./payload/entrypoint.py
sf data-code-extension script run \
  --entrypoint ./payload/entrypoint.py \
  --target-org my-sandbox
sf data-code-extension script zip --package-dir ./payload
sf data-code-extension script deploy \
  --name my-script \
  --package-version 1.0.0 \
  --description "My Data 360 batch transform" \
  --package-dir ./payload \
  --target-org my-sandbox
```

For a DMO-to-DMO transform, don't rely on `script scan` to produce the final configuration. Salesforce requires you to
manually define the output DMO schemas in `payload/config.json`. Salesforce also documents that CLI deployment doesn't
currently work as intended for DMO-to-DMO transforms; deploy that package through the Code Extension UI.

## Function workflow

Functions execute as custom chunking logic in a search-index pipeline:

```shell
sf data-code-extension function init --package-dir ./my-function
cd my-function
sf data-code-extension function scan --entrypoint ./payload/entrypoint.py --dry-run
sf data-code-extension function scan --entrypoint ./payload/entrypoint.py
sf data-code-extension function run \
  --entrypoint ./payload/entrypoint.py \
  --test-with ./payload/tests/test.json
sf data-code-extension function zip --package-dir ./payload
sf data-code-extension function deploy \
  --name my-function \
  --package-version 1.0.0 \
  --description "My search chunking function" \
  --package-dir ./payload \
  --target-org my-sandbox
```

The function output must contain an `output` list. Every returned chunk requires `text`, a continuous `seq_no`, and
`chunk_type`; `citations` is optional.

## Sandbox and production boundary

Author, test, and deploy code extensions in a Data 360 sandbox first. Salesforce's extensibility matrix supports Code
Extension in DevOps data kits, not standard data kits. After sandbox validation, package the extension and the Data 360
feature that invokes it into a DevOps data kit for production promotion.

The `sf data360 data-kit` commands manage the Data Kit lifecycle. The `sf data-code-extension` commands manage source
scaffolding, local validation, packaging, and sandbox upload. These are complementary workflows, not interchangeable
deployment formats.

## Verification boundary

The release package gate installs `sf-plugin-data360` into an isolated Salesforce CLI and runs help for all ten child
commands. The integration was additionally exercised on macOS with Python 3.11, SDK 6.0.4, `pipreqs` 0.5.0, Azul Zulu
17, and Docker:

- script and function `init`, `scan`, and `zip` completed against disposable packages;
- function `run` completed with the generated test payload;
- script `run` completed read-only against a live test-org DLO; and
- both deployment paths reached Salesforce authentication and the deployment endpoint.

The available test orgs returned `FUNCTIONALITY_NOT_ENABLED` for `CdpCustomCodeDeployment`, so this release does not
claim a successful sandbox upload. Enable Code Extension in Feature Manager on a Data 360 sandbox before expecting
`deploy` to succeed. No deployment resource was created by the rejected probes.

`@salesforce/plugin-data-code-extension` 1.3.2 calls the external `pipreqs` executable when an applied scan regenerates
`requirements.txt`, but the SDK and generated `requirements-dev.txt` don't currently install it. Install `pipreqs`
explicitly until that upstream packaging gap is resolved. `--dry-run` scanning doesn't require it.

## Primary references

- [Code Extension in Data 360](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/use-custom-code.html)
- [Set Up Salesforce CLI for Code Extension](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/set-up-sdk.html)
- [Write and Validate Custom Scripts](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/author-custom-script.html)
- [Write and Validate a Custom Chunking Function](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/write-custom-chunking-function.html)
- [Configure DMO-to-DMO Transforms](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/configure-dmo-schema.html)
- [Data 360 Extensibility Readiness Matrix](https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360a-api-isv-readiness-data.html)
- [Official Salesforce CLI plugin source](https://github.com/salesforcecli/plugin-data-code-extension)
