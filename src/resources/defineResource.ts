import { loadCommandMessages } from '../messages.js';
import type { ResourceDefinition } from './types.js';

const runtimeMessages = loadCommandMessages('data360.runtime.resources.defineResource');

const freezeRecord = <T>(value: T | undefined): T | undefined =>
  value === undefined ? undefined : (Object.freeze({ ...value }) as T);

const freezeNestedRecord = <T extends Readonly<Record<string, unknown>>>(value: T | undefined): T | undefined => {
  if (value === undefined) return undefined;
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        typeof entry === 'object' && entry !== null ? Object.freeze({ ...entry }) : entry,
      ])
    )
  ) as T;
};

export const defineResource = <T extends ResourceDefinition>(definition: T): Readonly<T> => {
  if (!definition.topic.trim()) throw new Error(runtimeMessages.getMessage('error.RUNTIME_0.0'));
  if (!/^\/[a-z0-9][a-z0-9/-]*$/.test(definition.base))
    throw new Error(runtimeMessages.getMessage('error.RUNTIME_1.1'));
  if (definition.nameFields.length === 0) throw new Error(runtimeMessages.getMessage('error.RUNTIME_2.2'));
  if (definition.columns.length === 0) throw new Error(runtimeMessages.getMessage('error.RUNTIME_3.3'));
  return Object.freeze({
    ...definition,
    nameFields: Object.freeze([...definition.nameFields]),
    columns: Object.freeze([...definition.columns]),
    operations: definition.operations ? Object.freeze([...definition.operations]) : undefined,
    operationSpecs: freezeNestedRecord(definition.operationSpecs),
    idKind: freezeRecord(definition.idKind),
    actions: freezeNestedRecord(definition.actions),
    destructive: freezeRecord(definition.destructive),
    billable: freezeRecord(definition.billable),
    numericRanges: freezeNestedRecord(definition.numericRanges),
    pagination: definition.pagination ? Object.freeze({ ...definition.pagination }) : undefined,
  }) as Readonly<T>;
};
