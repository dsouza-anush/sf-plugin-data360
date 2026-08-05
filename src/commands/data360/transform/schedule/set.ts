import { loadCommandMessages } from '../../../../messages.js';
import { Flags } from '@oclif/core';
import { TransformCommand } from '../../../../transform/command.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.transform.schedule.set');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class TransformScheduleSet extends TransformCommand<{ item: Record<string, unknown> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    cron: Flags.string({ exactlyOne: ['cron', 'interval'], summary: commandMessages.getMessage('flags.cron.summary') }),
    interval: Flags.string({
      exactlyOne: ['cron', 'interval'],
      summary: commandMessages.getMessage('flags.interval.summary'),
    }),
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };
  public async run(): Promise<{ item: Record<string, unknown> }> {
    const { flags, client } = await this.initializeTransform(TransformScheduleSet);
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('runtime.confirmSchedule', [String(flags.name)])
    );
    const key = await this.resolveKey(client, '/data-transforms', 'dataTransforms', flags.name as string);
    return {
      item: await client.request({
        method: 'PUT',
        endpoint: `/data-transforms/${encodeURIComponent(key)}/schedule`,
        body: flags.cron ? { cron: flags.cron } : { interval: flags.interval },
      }),
    };
  }
}
