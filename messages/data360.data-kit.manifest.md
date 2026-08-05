# summary

Get a Data 360 data-kit manifest.

# description

Get member components and dependencies from the singular `/ssot/datakit/{dataKitDevName}/manifest` v67 resource. The value can be a data-kit developer name or a `DataPackageKitDefinition` name.

# examples

- Get manifest members for a data kit:
  <%= config.bin %> <%= command.id %> --target-org my-org --name CustomerFoundation
- Return manifest members as JSON:
  <%= config.bin %> <%= command.id %> --target-org my-org --name CustomerFoundation --json

# flags.name.summary

Data-kit developer name or DataPackageKitDefinition name.
