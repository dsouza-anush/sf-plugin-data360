import { Data360Command } from '../../../command/Data360Command.js';
import { SsotClient } from '../../../client/ssotClient.js';
import { loadCommandMessages } from '../../../messages.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.docai.describe');

type DocAiGlobalConfig = {
  supportedContentTypes?: Array<Record<string, unknown>>;
  supportedModels?: Array<Record<string, unknown>>;
  version?: string;
};

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DocAiDescribe extends Data360Command<{ item: DocAiGlobalConfig }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    timing: timingFlag,
  };

  public async run(): Promise<{ item: DocAiGlobalConfig }> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(DocAiDescribe),
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => Boolean(flags.timing),
    });
    const { flags } = initialized.parsed;
    const client = new SsotClient(
      initialized.connection,
      flags['api-version'] ?? initialized.connection.version,
      initialized.requestTiming
    );
    const item = await client.get<DocAiGlobalConfig>('/document-processing/global-config');
    if (!this.jsonEnabled()) {
      this.status(commandMessages.getMessage('runtime.version', [item.version ?? 'unknown']));
      this.table({
        data: item.supportedContentTypes ?? [],
        columns: ['type', 'label', 'maxFileSizeInMB', 'isDefault'],
      });
      this.table({
        data: item.supportedModels ?? [],
        columns: ['id', 'label', 'provider', 'status', 'isDefault'],
      });
    }
    return { item };
  }
}
