import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { resolveCreditNotices } from '../../../configMeta.js';
import { TransformCommand } from '../../../transform/command.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';
import { billableNotice } from '../../../shared/billableNotice.js';

const commandMessages = loadCommandMessages('data360.transform.run');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class TransformRun extends TransformCommand<{ item: Record<string, unknown> }> {
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
    const { flags, client } = await this.initializeTransform(TransformRun);
    const key = await this.resolveKey(client, '/data-transforms', 'dataTransforms', flags.name as string);
    if (!this.jsonEnabled() && (await resolveCreditNotices())) this.status(billableNotice('Data Services'));
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('runtime.confirmDestructive', [String(flags.name)])
    );
    const item = await client.request<Record<string, unknown>>({
      method: 'POST',
      endpoint: `/data-transforms/${encodeURIComponent(key)}/actions/run`,
      timeoutMs: 120_000,
      errorContext: {
        actionTimeout: {
          label: 'data transform run',
          recoveryCommand: 'Run sf data360 transform report --name <name> --target-org <alias> before retrying.',
        },
      },
    });
    if (!this.jsonEnabled()) {
      this.status(
        commandMessages.getMessage('runtime.continuation', [String(flags.name), flags['target-org'].getUsername()])
      );
    }
    return { item };
  }
}
