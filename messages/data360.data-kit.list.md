# summary

List Data 360 data kits.

# description

List data kits from `GET /ssot/data-kits`, optionally filtered by package namespace. This API has no get-single operation; use `data-kit manifest` when you need a kit's member metadata.

# examples

- List all visible data kits:
  <%= config.bin %> <%= command.id %> --target-org my-org
- Filter data kits by namespace:
  <%= config.bin %> <%= command.id %> --target-org my-org --namespace acme

# flags.namespace.summary

Namespace prefix used to filter data kits.
