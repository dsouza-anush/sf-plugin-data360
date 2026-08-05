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

export abstract class ActivationCommand<T> extends Data360Command<T> {
  protected async initializeActivation(command: unknown): Promise<{ flags: RuntimeFlags; client: SsotClient }> {
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

  protected async resolveId(client: SsotClient, value: string): Promise<string> {
    return resolveResourceKey(value, {
      idKind: 'id',
      idField: 'activationId',
      nameFields: ['activationName', 'displayName'],
      list: async () => listAllSsot(client, { endpoint: '/activations', arrayKey: 'activations' }),
    });
  }
}
