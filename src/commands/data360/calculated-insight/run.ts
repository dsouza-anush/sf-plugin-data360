import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { CalculatedInsightCommand } from '../../../calculatedInsight/command.js';
import { resolveCreditNotices } from '../../../configMeta.js';
import { billableNotice } from '../../../shared/billableNotice.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.calculated-insight.run');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class CalculatedInsightRun extends CalculatedInsightCommand<{ item: Record<string, unknown> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };

  public async run(): Promise<{ item: Record<string, unknown> }> {
    const { flags, client } = await this.initializeCalculatedInsight(CalculatedInsightRun);
    const apiName = await this.resolveApiName(client, flags.name as string);
    if (!apiName.endsWith('__cio')) {
      throw new SfError(commandMessages.getMessage('error.D360_INVALID_DEFINITION.0'), 'D360_INVALID_DEFINITION', [
        commandMessages.getMessage('error.D360_INVALID_DEFINITION.0.actions.1'),
      ]);
    }
    if (!this.jsonEnabled() && (await resolveCreditNotices())) this.status(billableNotice('Calculated Insights'));
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('runtime.confirmDestructive', [String(flags.name)])
    );
    return {
      item: await client.request({
        method: 'POST',
        endpoint: `/calculated-insights/${encodeURIComponent(apiName)}/actions/run`,
        body: {},
      }),
    };
  }
}
