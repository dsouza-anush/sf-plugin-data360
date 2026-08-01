import { SfError } from '@salesforce/core';
import { loadCommandMessages } from '../messages.js';
import { loadDefinition } from '../shared/definitionFile.js';

const runtimeMessages = loadCommandMessages('data360.runtime.query.options');

export const QUERY_PARAMETER_TYPES = [
  'ArrayOfX',
  'BigInt',
  'Bool',
  'Char',
  'Date',
  'Double',
  'Float',
  'Integer',
  'Numeric',
  'Oid',
  'SmallInt',
  'Time',
  'Timestamp',
  'TimestampTZ',
  'Unspecified',
  'Varchar',
] as const;

export type QuerySqlParameterType = (typeof QUERY_PARAMETER_TYPES)[number];
export type QuerySqlParameter = {
  name: string;
  type: QuerySqlParameterType;
  value: string;
};
export type QuerySqlOptions = {
  sqlParameters?: QuerySqlParameter[];
  querySettings?: Record<string, string>;
};

const parameterTypes = new Set<string>(QUERY_PARAMETER_TYPES);

export const loadQuerySqlOptions = async (source: string): Promise<QuerySqlOptions> => {
  const definition = await loadDefinition(source);
  const unknown = Object.keys(definition).filter((key) => !['querySettings', 'sqlParameters'].includes(key));
  if (unknown.length > 0) {
    throw new SfError(
      runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.0', [unknown.join(', ')]),
      'D360_INVALID_DEFINITION',
      [runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.0.actions.1')]
    );
  }

  const result: QuerySqlOptions = {};
  if (definition.sqlParameters !== undefined) {
    if (!Array.isArray(definition.sqlParameters) || !definition.sqlParameters.every(isQuerySqlParameter)) {
      throw new SfError(runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.1'), 'D360_INVALID_DEFINITION', [
        runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.1.actions.1'),
      ]);
    }
    result.sqlParameters = definition.sqlParameters;
  }

  if (definition.querySettings !== undefined) {
    if (
      !isRecord(definition.querySettings) ||
      !Object.values(definition.querySettings).every((value) => typeof value === 'string')
    ) {
      throw new SfError(runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.2'), 'D360_INVALID_DEFINITION', [
        runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.2.actions.1'),
      ]);
    }
    result.querySettings = definition.querySettings as Record<string, string>;
  }
  return result;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isQuerySqlParameter = (value: unknown): value is QuerySqlParameter =>
  isRecord(value) &&
  Object.keys(value).every((key) => ['name', 'type', 'value'].includes(key)) &&
  typeof value.name === 'string' &&
  value.name.trim().length > 0 &&
  typeof value.type === 'string' &&
  parameterTypes.has(value.type) &&
  typeof value.value === 'string';
