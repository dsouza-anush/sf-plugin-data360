# summary

Describe resources available through a Data 360 connection.

# description

Describe resources available through a Data 360 connection. Uses verified Data 360 Connect API endpoints and supports global JSON output.

# examples

- Run the command against the configured org:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --databases
- Run the command with machine-readable output:
  <%= config.bin %> <%= command.id %> --target-org my-org --name Example --databases --json

# flags.name.summary

Developer name, display name, or ID of the resource.

# flags.databases.summary

Include available databases in the description.

# flags.schemas.summary

Include available schemas in the description.

# flags.objects.summary

Include available objects in the description.

# flags.fields.summary

Include fields for the selected object in the description.

# flags.preview.summary

Include a data preview for the selected object.

# flags.endpoints.summary

Include connector endpoints in the description.

# flags.sitemap.summary

Include the connector sitemap in the description.

# flags.object.summary

Object developer name to describe.

# error.D360_API_ERROR

The Data 360 API rejected the request.

# error.D360_API_ERROR.actions

Re-run with --json and correct the request.

# error.D360_INVALID_DEFINITION.0

Select at least one connection description section.

# error.D360_INVALID_DEFINITION.0.actions.1

Pass --databases, --schemas, --objects, --fields, --preview, --endpoints, or --sitemap.
