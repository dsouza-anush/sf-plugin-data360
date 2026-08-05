# summary

List Data 360 metadata entities.

# description

List Data Lake Objects, Data Model Objects, calculated insights, and other metadata visible in a data space.

# examples

- List the first five metadata entities:
  <%= config.bin %> <%= command.id %> --limit 5 --target-org my-org
- List all Data Model Objects as JSON rows:
  <%= config.bin %> <%= command.id %> --entity-type DataModelObject --all --result-format json --target-org my-org

# flags.entity-type.summary

Filter by entity type, such as DataModelObject or DirectoryTable.

# flags.entity-category.summary

Filter by metadata category.

# error.D360_NOT_PROVISIONED

Data 360 metadata is unavailable in the target org.

# error.D360_NOT_PROVISIONED.actions

Run `sf data360 doctor` and confirm Data 360 is provisioned.
