import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { TransformCommand } from '../../../transform/command.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.transform.cancel');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class TransformCancel extends TransformCommand<{ cancelled: true; name: string }> {
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
  public async run(): Promise<{ cancelled: true; name: string }> {
    const { flags, client } = await this.initializeTransform(TransformCancel);
    const key = await this.resolveKey(client, '/data-transforms', 'dataTransforms', flags.name as string);
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('runtime.confirmDestructive.0', [String(String(flags.name))])
    );
    await client.request({
      method: 'POST',
      endpoint: `/data-transforms/${encodeURIComponent(key)}/actions/cancel`,
    });
    return { cancelled: true, name: flags.name as string };
  }
}
