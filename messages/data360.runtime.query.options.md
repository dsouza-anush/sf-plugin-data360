# error.D360_INVALID_DEFINITION.0

The query options file contains unsupported top-level fields: %s.

# error.D360_INVALID_DEFINITION.0.actions.1

Use only `sqlParameters` and `querySettings` in the query options file.

# error.D360_INVALID_DEFINITION.1

`sqlParameters` must be an array of objects with non-empty `name`, supported `type`, and string `value` fields.

# error.D360_INVALID_DEFINITION.1.actions.1

Use a parameter type documented by the Data 360 Query SQL API and encode each value as a string.

# error.D360_INVALID_DEFINITION.2

`querySettings` must be an object whose values are strings.

# error.D360_INVALID_DEFINITION.2.actions.1

Use string settings such as `date_style`, `lc_time`, or `query_timeout`.
