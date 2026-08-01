import type { Connection } from '@salesforce/core';
import { Data360Command } from '../command/Data360Command.js';
import { SsotClient } from '../client/ssotClient.js';
import { listAllSsot } from '../shared/listAll.js';
import { resolveResourceKey } from '../shared/nameResolver.js';
import type { ResourceIdKind } from '../resources/types.js';

type RuntimeFlags = Record<string, unknown> & {
  'target-org': { getConnection: (version?: string) => Promise<Connection> };
  'api-version'?: string;
  timing?: boolean;
};

export abstract class SegmentCommand<T> extends Data360Command<T> {
  protected unwrapSegment(response: Record<string, unknown>): Record<string, unknown> {
    return Array.isArray(response.segments) && response.segments.length === 1
      ? ((response.segments[0] ?? {}) as Record<string, unknown>)
      : response;
  }

  protected async initializeSegment(command: unknown): Promise<{ flags: RuntimeFlags; client: SsotClient }> {
    const initialized = await this.initializeTiming<{ flags: RuntimeFlags }, Connection>({
      parse: async () => (await this.parse(command as never)) as unknown as { flags: RuntimeFlags },
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => Boolean(flags.timing),
    });
    return {
      flags: initialized.parsed.flags,
      client: new SsotClient(
        initialized.connection,
        initialized.parsed.flags['api-version'] ?? initialized.connection.version,
        initialized.requestTiming
      ),
    };
  }

  protected async resolveKey(client: SsotClient, value: string, idKind: ResourceIdKind): Promise<string> {
    return resolveResourceKey(value, {
      idKind,
      idField: 'marketSegmentId',
      apiNameField: 'segmentApiName',
      nameFields: ['segmentApiName', 'apiName', 'displayName'],
      // The live Segment service returns `apiName`, while older responses and
      // the published Connect API examples use `segmentApiName`. Normalize the
      // live shape so every segment operation resolves to the same wire key.
      list: async () =>
        (await listAllSsot(client, { endpoint: '/segments', arrayKey: 'segments' })).map((item) => ({
          ...item,
          segmentApiName:
            typeof item.segmentApiName === 'string' && item.segmentApiName.length > 0
              ? item.segmentApiName
              : item.apiName,
        })),
    });
  }
}
