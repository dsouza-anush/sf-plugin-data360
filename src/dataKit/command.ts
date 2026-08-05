import { access } from 'node:fs/promises';
import type { Connection } from '@salesforce/core';
import { Data360Command } from '../command/Data360Command.js';
import { SsotClient } from '../client/ssotClient.js';
import { DataKitClient, type DataKitAsyncResult, type DataKitRecord } from './client.js';

export type DataKitRuntimeFlags = Record<string, unknown> & {
  'target-org': {
    getConnection: (version?: string) => Promise<Connection>;
    getUsername: () => string | undefined;
  };
  'api-version'?: string;
  timing?: boolean;
};

type RequiredStringFlagOptions = {
  char?: 'f' | 'n';
  required: true;
  summary: string;
  parse?: (value: string) => Promise<string>;
};

export const dataKitNameOptions = (summary: string): RequiredStringFlagOptions => ({
  char: 'n',
  required: true,
  summary,
});

export const componentNameOptions = (summary: string): RequiredStringFlagOptions => ({ required: true, summary });

export const definitionFileOptions = (summary: string): RequiredStringFlagOptions => ({
  char: 'f',
  required: true,
  summary,
  parse: async (value: string): Promise<string> => {
    if (value !== '-') await access(value);
    return value;
  },
});

const nestedRecord = (value: unknown): DataKitRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as DataKitRecord) : {};

export const dataKitRows = (items: DataKitRecord[]): DataKitRecord[] =>
  items.map((item) => ({
    ...item,
    developerName: item.developerName ?? item.devName,
    'components#': Array.isArray(item.components) ? item.components.length : 0,
    'publishingSequence#': Array.isArray(item.publishingSequence) ? item.publishingSequence.length : 0,
  }));

export const componentRows = (items: DataKitRecord[]): DataKitRecord[] =>
  items.map((item) => {
    const info = nestedRecord(item.info);
    return {
      type: item.type ?? item.componentType,
      name: info.name ?? item.name ?? item.developerName,
      label: info.label ?? item.label,
      connectorType: info.connectorType ?? item.connectorType,
    };
  });

export const manifestRows = (items: DataKitRecord[]): DataKitRecord[] =>
  items.map((item) => ({
    entityName: item.entityName,
    developerName: Array.isArray(item.developerName) ? item.developerName.join(',') : item.developerName,
    id: Array.isArray(item.id) ? item.id.join(',') : item.id,
  }));

export const componentStatusRows = (item: DataKitRecord): DataKitRecord[] => {
  const status = nestedRecord(item.status);
  const details = Array.isArray(item.componentDetails) ? item.componentDetails.map(nestedRecord) : [];
  return details.length > 0
    ? details.map((detail) => ({ ...detail, code: status.code, message: status.message }))
    : [status];
};

export abstract class DataKitCommand<T> extends Data360Command<T> {
  protected async initializeDataKit(command: unknown): Promise<{
    flags: DataKitRuntimeFlags;
    client: DataKitClient;
    username: string;
  }> {
    const initialized = await this.initializeTiming<{ flags: DataKitRuntimeFlags }, Connection>({
      parse: async () => (await this.parse(command as never)) as unknown as { flags: DataKitRuntimeFlags },
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => Boolean(flags.timing),
    });
    return {
      flags: initialized.parsed.flags,
      client: new DataKitClient(
        new SsotClient(
          initialized.connection,
          initialized.parsed.flags['api-version'] ?? initialized.connection.version,
          initialized.requestTiming
        )
      ),
      username: initialized.parsed.flags['target-org'].getUsername() ?? '<org-alias>',
    };
  }

  protected asyncResult(item: DataKitRecord, continuation: string): DataKitAsyncResult {
    const jobId = typeof item.jobId === 'string' ? item.jobId : undefined;
    if (!this.jsonEnabled()) {
      this.table({ data: [item], columns: jobId ? ['jobId'] : Object.keys(item) });
      this.status(continuation);
    }
    return { item, ...(jobId ? { jobId } : {}) };
  }
}
