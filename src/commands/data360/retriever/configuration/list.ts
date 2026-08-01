import { Flags } from '@oclif/core';
import { Data360Command } from '../../../../command/Data360Command.js';
import { SsotClient } from '../../../../client/ssotClient.js';
import { loadCommandMessages } from '../../../../messages.js';
import { allFlag, apiVersionFlag, limitFlag, targetOrgFlag, timingFlag } from '../../../../shared/flags.js';
import { listAllSsot } from '../../../../shared/listAll.js';
import { listRetrievers, resolveRetrieverKey } from '../../../../retriever/client.js';

const commandMessages = loadCommandMessages('data360.retriever.configuration.list');

type ConfigurationListResult = { items: Array<Record<string, unknown>> };

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class RetrieverConfigurationList extends Data360Command<ConfigurationListResult> {
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
    all: allFlag,
    limit: limitFlag,
    timing: timingFlag,
  };

  public async run(): Promise<ConfigurationListResult> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(RetrieverConfigurationList),
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => Boolean(flags.timing),
    });
    const { flags } = initialized.parsed;
    const client = new SsotClient(
      initialized.connection,
      flags['api-version'] ?? initialized.connection.version,
      initialized.requestTiming
    );
    const name = await resolveRetrieverKey(flags.name!, await listRetrievers(client));
    const items = await listAllSsot(client, {
      endpoint: `/machine-learning/retrievers/${encodeURIComponent(name)}/configurations`,
      arrayKey: 'configurations',
      limit: flags.all ? undefined : flags.limit,
    });
    if (!this.jsonEnabled()) {
      this.table({
        data: items,
        columns: ['name', 'label', 'version', 'isActive', 'retrievalMode', 'lastModifiedDate'],
      });
    }
    return { items };
  }
}
