# summary

Create a Data 360 data kit.

# description

Create a standard data kit from a JSON definition containing `dataKitDevName`, `label`, `dataKitType`, and `components`. The response represents the developer name as `devName`.

# examples

- Create a data kit from a JSON file:
  <%= config.bin %> <%= command.id %> --target-org my-org --file examples/data-kit/data-kit.json
- Read the data-kit definition from stdin:
  <%= config.bin %> <%= command.id %> --target-org my-org --file - < examples/data-kit/data-kit.json

# flags.file.summary

Path to the data-kit JSON definition, or `-` to read stdin. The definition must be a JSON object.
