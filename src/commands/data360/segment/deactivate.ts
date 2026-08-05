import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { SegmentCommand } from '../../../segment/command.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.segment.deactivate');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class SegmentDeactivate extends SegmentCommand<{ item: Record<string, unknown> }> {
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
    const { flags, client } = await this.initializeSegment(SegmentDeactivate);
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('runtime.confirmDestructive.0', [String(String(flags.name))])
    );
    const apiName = await this.resolveKey(client, flags.name as string, 'apiName');
    return {
      item: await client.request({
        method: 'POST',
        endpoint: `/segments/${encodeURIComponent(apiName)}/actions/deactivate`,
        body: {},
      }),
    };
  }
}
