import type { Connection } from '@salesforce/core';
import { Data360Command } from '../command/Data360Command.js';
import { SsotClient } from '../client/ssotClient.js';
import { DataStreamClient } from './client.js';
type RuntimeFlags = Record<string, unknown> & {
  'target-org': { getConnection: (version?: string) => Promise<Connection>; getUsername: () => string | undefined };
  'api-version'?: string;
  timing?: boolean;
};
export abstract class DataStreamCommand<T> extends Data360Command<T> {
  protected async initializeStream(command: unknown): Promise<{ flags: RuntimeFlags; client: DataStreamClient }> {
    const initialized = await this.initializeTiming<{ flags: RuntimeFlags }, Connection>({
      parse: async () => (await this.parse(command as never)) as unknown as { flags: RuntimeFlags },
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => Boolean(flags.timing),
    });
    return {
      flags: initialized.parsed.flags,
      client: new DataStreamClient(
        new SsotClient(
          initialized.connection,
          initialized.parsed.flags['api-version'] ?? initialized.connection.version,
          initialized.requestTiming
        )
      ),
    };
  }
}
