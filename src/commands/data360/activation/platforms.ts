import { loadCommandMessages } from '../../../messages.js';
import type { Connection } from '@salesforce/core';
import { Data360Command } from '../../../command/Data360Command.js';
import { SsotClient } from '../../../client/ssotClient.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.activation.platforms');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class ActivationPlatforms extends Data360Command<{ items: Array<Record<string, unknown>> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    timing: timingFlag,
  };
  public async run(): Promise<{ items: Array<Record<string, unknown>> }> {
    const initialized = await this.initializeTiming<
      {
        flags: {
          'target-org': { getConnection: (version?: string) => Promise<Connection> };
          'api-version'?: string;
          timing?: boolean;
        };
      },
      Connection
    >({
      parse: async () => (await this.parse(ActivationPlatforms)) as never,
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => Boolean(flags.timing),
    });
    const response = await new SsotClient(
      initialized.connection,
      initialized.parsed.flags['api-version'] ?? initialized.connection.version,
      initialized.requestTiming
    ).request<unknown>({ method: 'GET', endpoint: '/activation-external-platforms' });
    const record = response as { activationExternalPlatforms?: Array<Record<string, unknown>> };
    return { items: Array.isArray(response) ? response : (record.activationExternalPlatforms ?? []) };
  }
}
