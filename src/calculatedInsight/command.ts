import type { Connection } from '@salesforce/core';
import { Data360Command } from '../command/Data360Command.js';
import { SsotClient } from '../client/ssotClient.js';
import { listAllSsot } from '../shared/listAll.js';
import { resolveResourceKey } from '../shared/nameResolver.js';

type RuntimeFlags = Record<string, unknown> & {
  'target-org': { getConnection: (version?: string) => Promise<Connection> };
  'api-version'?: string;
  timing?: boolean;
};

export abstract class CalculatedInsightCommand<T> extends Data360Command<T> {
  protected async initializeCalculatedInsight(command: unknown): Promise<{ flags: RuntimeFlags; client: SsotClient }> {
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

  protected async resolveApiName(client: SsotClient, value: string): Promise<string> {
    return resolveResourceKey(value, {
      idKind: 'apiName',
      apiNameField: 'apiName',
      nameFields: ['apiName', 'displayName'],
      list: async () => listAllSsot(client, { endpoint: '/calculated-insights', arrayKey: 'calculatedInsights' }),
    });
  }
}
