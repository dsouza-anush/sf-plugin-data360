import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { resolveCreditNotices } from '../../../configMeta.js';
import { IdentityResolutionCommand } from '../../../identityResolution/command.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';
import { billableNotice } from '../../../shared/billableNotice.js';

const commandMessages = loadCommandMessages('data360.identity-resolution.run');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class IdentityResolutionRun extends IdentityResolutionCommand<{ item: Record<string, unknown> }> {
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
    const { flags, client } = await this.initializeIdentityResolution(IdentityResolutionRun);
    if (!this.jsonEnabled() && (await resolveCreditNotices())) this.status(billableNotice('Identity Resolution'));
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('runtime.confirmDestructive.1', [String(String(flags.name))])
    );
    const id = await this.resolveId(client, flags.name as string);
    const item = await client.request<Record<string, unknown>>({
      method: 'POST',
      endpoint: `/identity-resolutions/${encodeURIComponent(id)}/actions/run-now`,
      body: {},
    });
    if (!this.jsonEnabled()) {
      this.status(
        commandMessages.getMessage('runtime.continuation', [String(flags.name), flags['target-org'].getUsername()])
      );
    }
    return { item };
  }
}
