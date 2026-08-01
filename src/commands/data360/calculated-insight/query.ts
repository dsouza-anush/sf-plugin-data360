import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { CalculatedInsightCommand } from '../../../calculatedInsight/command.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.calculated-insight.query');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class CalculatedInsightQuery extends CalculatedInsightCommand<{ item: Record<string, unknown> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    dimensions: Flags.string({ summary: commandMessages.getMessage('flags.dimensions.summary') }),
    measures: Flags.string({ summary: commandMessages.getMessage('flags.measures.summary') }),
    filters: Flags.string({ summary: commandMessages.getMessage('flags.filters.summary') }),
    'time-granularity': Flags.string({ summary: commandMessages.getMessage('flags.time-granularity.summary') }),
    describe: Flags.boolean({ summary: commandMessages.getMessage('flags.describe.summary') }),
    timing: timingFlag,
  };

  public async run(): Promise<{ item: Record<string, unknown> }> {
    const { flags, client } = await this.initializeCalculatedInsight(CalculatedInsightQuery);
    const apiName = await this.resolveApiName(client, flags.name as string);
    const endpoint = flags.describe
      ? `/insight/metadata/${encodeURIComponent(apiName)}`
      : `/insight/calculated-insights/${encodeURIComponent(apiName)}`;
    return {
      item: await client.request({
        method: 'GET',
        endpoint,
        query: flags.describe
          ? undefined
          : {
              dimensions: flags.dimensions as string | undefined,
              measures: flags.measures as string | undefined,
              filters: flags.filters as string | undefined,
              timeGranularity: flags['time-granularity'] as string | undefined,
            },
      }),
    };
  }
}
