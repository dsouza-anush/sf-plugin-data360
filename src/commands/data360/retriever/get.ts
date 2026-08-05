import { Flags } from '@oclif/core';
import { loadCommandMessages } from '../../../messages.js';
import { Data360Command } from '../../../command/Data360Command.js';
import { SsotClient } from '../../../client/ssotClient.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';
import { listRetrievers, resolveRetrieverKey } from '../../../retriever/client.js';

const commandMessages = loadCommandMessages('data360.retriever.get');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class RetrieverGet extends Data360Command<{ item: Record<string, unknown> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({
      char: 'n',
      required: true,
      summary: commandMessages.getMessage('flags.name.summary'),
    }),
    timing: timingFlag,
  };

  public async run(): Promise<{ item: Record<string, unknown> }> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(RetrieverGet),
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => Boolean(flags.timing),
    });
    const { flags } = initialized.parsed;
    const client = new SsotClient(
      initialized.connection,
      flags['api-version'] ?? initialized.connection.version,
      initialized.requestTiming
    );
    const key = await resolveRetrieverKey(flags.name!, await listRetrievers(client));
    const item = await client.get<Record<string, unknown>>(`/machine-learning/retrievers/${encodeURIComponent(key)}`);
    if (!this.jsonEnabled()) this.table({ data: [item], columns: ['name', 'label', 'dataSourceType', 'isGlobal'] });
    return { item };
  }
}
