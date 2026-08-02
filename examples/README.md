# Example inputs

These files are curated, source-backed starting points for representative `--file` and query workflows. They contain disposable placeholder names and no credentials or customer data. They are not a claim that every command-specific mutation payload is interchangeable: consult the [generated command reference](../docs/COMMAND_REFERENCE.md) and the authoritative API contract linked from the [coverage ledger](../docs/API_COVERAGE.md) for commands without a vetted file here. Review every mutation against your org's Data 360 model before running it.

## Query

```shell
sf data360 query \
  --file examples/query/individuals.sql \
  --target-org my-org
```

## Ingestion

The source and object must already exist in an Ingestion API connection. Validation is non-billable; streaming or bulk submission can consume Data 360 credits.

```shell
sf data360 ingest validate \
  --source-name Example_Ingest_Source \
  --object-name example_event \
  --file examples/ingest/records.ndjson \
  --target-org my-org

sf data360 ingest bulk \
  --source-name Example_Ingest_Source \
  --object-name example_event \
  --file examples/ingest/records.csv \
  --target-org my-org
```

## DLO, DMO, mapping, and relationship

The definitions mirror the disposable shapes used by the repository's live verification harness. Names ending in `__dll` and `__dlm` in dependent files assume the preceding creates completed successfully.

```shell
sf data360 dlo create --file examples/definitions/dlo-create.json --target-org my-org
sf data360 dmo create --file examples/definitions/dmo-create.json --target-org my-org
sf data360 mapping create --file examples/definitions/mapping-create.json --target-org my-org
sf data360 dmo relationship create \
  --name ExampleEvent__dlm \
  --file examples/definitions/relationship-create.json \
  --target-org my-org
```

## Data-space members

The member-set input uses the nested Connect API member contract internally. The CLI file itself contains a top-level `members` array; each member uses `memberName` and a filter object. The example applies no row filter.

```shell
sf data360 data-space member list \
  --name default \
  --target-org my-org

sf data360 data-space member set \
  --name default \
  --file examples/definitions/data-space-members.json \
  --target-org my-org
```

Replace `ExampleEvent__dll` with an existing DLO. Member changes affect data access, so capture the current member list and review the target data space before running the mutation.

## Data Kits

The Data Kit samples follow the Salesforce Connect REST API v67 request shapes. Replace the placeholder component names and connector values with components that exist in your org. All ten Data Kit commands have successful command-specific live evidence, including disposable deployment and asynchronous cleanup against an eligible external kit.

```shell
sf data360 data-kit create \
  --file examples/data-kit/data-kit.json \
  --target-org my-org

sf data360 data-kit update \
  --name CustomerFoundation \
  --file examples/data-kit/components.json \
  --target-org my-org \
  --no-prompt

sf data360 data-kit deploy \
  --name CustomerFoundation \
  --file examples/data-kit/deploy.json \
  --target-org my-org

sf data360 data-kit undeploy \
  --name CustomerFoundation \
  --file examples/data-kit/undeploy.json \
  --target-org my-org \
  --no-prompt
```

Deploy and undeploy use `asyncMode=true` internally. A local kit cannot be deployed back into the same org; use an eligible promotion target and follow up with `sf data360 data-kit component status`. The v67 API exposes per-component deployment status rather than a deployment-job status endpoint.

## Code Extensions

The packaged Salesforce child plugin scaffolds complete examples rather than this repository maintaining a second copy:

```shell
sf data-code-extension script init --package-dir ./my-script
sf data-code-extension function init --package-dir ./my-function
```

Each generated project includes `payload/entrypoint.py`, `payload/config.json`, requirements files, and examples for its
execution model. Continue with [Data 360 Code Extensions](../docs/CODE_EXTENSIONS.md) for all ten commands and the
sandbox-to-DevOps-data-kit workflow.

## Commands without a curated payload file

Generic filenames such as `activation.json` in command help describe the required file role; they don't imply that an unrelated example is compatible. For these families, start with the exact command entry in the [generated reference](../docs/COMMAND_REFERENCE.md) and validate the request against the [Data 360 Connect REST API specification](https://developer.salesforce.com/docs/data/connectapi/references/spec). Do not infer a mutation body from a response fixture or an example for another family.

Source-repository testers can inspect the corresponding command tests as internal wire-contract evidence, but those tests are deliberately absent from the npm artifact and are not customer-data templates. Replace every name with a disposable prefix, run only against an approved non-production org, and record cleanup before creation.

Use a disposable org or explicitly approved test resources. Record created identifiers and remove resources in reverse dependency order. The [command reference](../docs/COMMAND_REFERENCE.md) lists every command, flag, and example generated from the current oclif manifest.
