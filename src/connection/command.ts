import type { Connection } from '@salesforce/core';
import { Data360Command } from '../command/Data360Command.js';
import { SsotClient } from '../client/ssotClient.js';
import { ConnectionClient } from './client.js';

type RuntimeFlags = Record<string, unknown> & {
  'target-org': { getConnection: (version?: string) => Promise<Connection> };
  'api-version'?: string;
  timing?: boolean;
};

export abstract class ConnectionCommand<T> extends Data360Command<T> {
  protected async initializeConnection(command: unknown): Promise<{
    flags: RuntimeFlags;
    client: ConnectionClient;
  }> {
    const initialized = await this.initializeTiming<{ flags: RuntimeFlags }, Connection>({
      parse: async () => (await this.parse(command as never)) as unknown as { flags: RuntimeFlags },
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => Boolean(flags.timing),
    });
    return {
      flags: initialized.parsed.flags,
      client: new ConnectionClient(
        new SsotClient(
          initialized.connection,
          initialized.parsed.flags['api-version'] ?? initialized.connection.version,
          initialized.requestTiming
        )
      ),
    };
  }
}
