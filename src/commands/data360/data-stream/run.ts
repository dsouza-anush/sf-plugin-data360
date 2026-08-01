import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { resolveCreditNotices } from '../../../configMeta.js';
import { DataStreamCommand } from '../../../dataStream/command.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';
import { billableNotice } from '../../../shared/billableNotice.js';

const commandMessages = loadCommandMessages('data360.data-stream.run');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DataStreamRun extends DataStreamCommand<{ item: Record<string, unknown> }> {
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
    const { flags, client } = await this.initializeStream(DataStreamRun);
    const stream = await client.inspect(flags.name as string);
    if (stream.item.externalSource === true && !this.jsonEnabled() && (await resolveCreditNotices())) {
      this.status(billableNotice('Data Services'));
    }
    if (stream.item.externalSource === true) {
      await this.confirmDestructive(
        Boolean(flags['no-prompt']),
        commandMessages.getMessage('runtime.confirmBillable', [String(flags.name)])
      );
    }
    const item = await client.runResolved(stream);
    if (!this.jsonEnabled()) {
      this.status(
        commandMessages.getMessage('runtime.continuation', [String(flags.name), flags['target-org'].getUsername()])
      );
    }
    return { item };
  }
}
