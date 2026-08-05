import { loadCommandMessages } from '../../../messages.js';
import { Data360Command } from '../../../command/Data360Command.js';
import { SsotClient } from '../../../client/ssotClient.js';
import {
  apiVersionFlag,
  dataSpaceFlag,
  noPromptFlag,
  optionalTargetOrgFlag,
  queryIdFlag,
  timingFlag,
  useMostRecentFlag,
  workloadNameFlag,
} from '../../../shared/flags.js';
import { resolveQueryContext } from '../../../run/queryContext.js';
import { QueryJobAdapter } from '../../../run/queryJobAdapter.js';

const commandMessages = loadCommandMessages('data360.query.cancel');

export type QueryCancelResult = {
  queryId: string;
  cancelled: true;
};

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class QueryCancel extends Data360Command<QueryCancelResult> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': optionalTargetOrgFlag,
    'api-version': apiVersionFlag,
    'data-space': dataSpaceFlag,
    'query-id': queryIdFlag,
    'use-most-recent': useMostRecentFlag,
    'workload-name': workloadNameFlag,
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };

  public async run(): Promise<QueryCancelResult> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(QueryCancel),
      connect: async ({ flags }) =>
        resolveQueryContext({
          queryId: flags['query-id'],
          useMostRecent: flags['use-most-recent'],
          targetOrg: flags['target-org'],
          apiVersion: flags['api-version'],
          dataSpace: flags['data-space'],
        }),
      timingSelected: ({ flags }) => flags.timing,
    });
    const { flags } = initialized.parsed;
    const context = initialized.connection;
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('runtime.confirmCancel', [context.queryId])
    );
    const client = new SsotClient(context.connection, context.apiVersion, initialized.requestTiming);
    await new QueryJobAdapter(client, context.dataSpace, flags['workload-name'] ?? context.entry?.workloadName).cancel(
      context.queryId
    );
    return { queryId: context.queryId, cancelled: true };
  }
}
