import { loadCommandMessages } from '../messages.js';
import { SfError } from '@salesforce/core';
import type { ResourceIdKind } from '../resources/types.js';

const runtimeMessages = loadCommandMessages('data360.runtime.shared.nameResolver');

export type NameRecord = Readonly<Record<string, unknown>>;
export type ResolveResourceKeyOptions = {
  idKind: ResourceIdKind;
  idField?: string;
  apiNameField?: string;
  nameFields: readonly string[];
  list: () => Promise<readonly NameRecord[]>;
};

const isSalesforceId = (value: string): boolean => /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/u.test(value);

const stringField = (record: NameRecord, field: string): string | undefined => {
  const value = record[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

// Adapted from Jaganpro/sf-cli-plugin-data360 (MIT); ambiguity is rejected instead of choosing arbitrarily.
export const resolveResourceKey = async (value: string, options: ResolveResourceKeyOptions): Promise<string> => {
  if (options.idKind !== 'apiName' && isSalesforceId(value)) return value;
  if (options.idKind === 'idOrApiName' && /__(?:dll|dlm)$/u.test(value)) return value;

  const records = await options.list();
  const normalized = value.toLocaleLowerCase('en-US');
  const matches = records.filter((record) =>
    options.nameFields.some((field) => stringField(record, field)?.toLocaleLowerCase('en-US') === normalized)
  );

  if (matches.length === 0) {
    const suggestions = records
      .flatMap((record) => options.nameFields.map((field) => stringField(record, field)))
      .filter((candidate): candidate is string => candidate !== undefined)
      .filter((candidate, index, all) => all.indexOf(candidate) === index)
      .slice(0, 20);
    throw new SfError(
      runtimeMessages.getMessage('error.D360_NAME_NOT_FOUND.0', [String(value)]),
      'D360_NAME_NOT_FOUND',
      [
        suggestions.length > 0
          ? `Available resources include: ${suggestions.join(', ')}.`
          : 'List the resources and retry with an exact name or ID.',
      ]
    );
  }

  if (matches.length > 1) {
    throw new SfError(
      runtimeMessages.getMessage('error.D360_NAME_AMBIGUOUS.1', [String(value)]),
      'D360_NAME_AMBIGUOUS',
      [runtimeMessages.getMessage('error.D360_NAME_AMBIGUOUS.1.actions.1')]
    );
  }

  const keyField =
    options.idKind === 'id' ? (options.idField ?? 'id') : (options.apiNameField ?? options.nameFields[0]);
  const key =
    stringField(matches[0], keyField) ??
    (options.idKind === 'id'
      ? undefined
      : options.nameFields.map((field) => stringField(matches[0], field)).find((candidate) => candidate !== undefined));
  if (!key) {
    throw new SfError(
      runtimeMessages.getMessage('error.D360_NAME_NOT_FOUND.2', [String(keyField)]),
      'D360_NAME_NOT_FOUND',
      [runtimeMessages.getMessage('error.D360_NAME_NOT_FOUND.2.actions.1')]
    );
  }

  return key;
};
