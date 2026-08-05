import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { DataStreamCommand } from '../../../dataStream/command.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.data-stream.delete');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DataStreamDelete extends DataStreamCommand<{ deleted: true; deleteDlo: boolean }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    'delete-dlo': Flags.boolean({ summary: commandMessages.getMessage('flags.delete-dlo.summary') }),
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };
  public async run(): Promise<{ deleted: true; deleteDlo: boolean }> {
    const { flags, client } = await this.initializeStream(DataStreamDelete);
    const noPrompt = Boolean(flags['no-prompt']);
    await this.confirmDestructive(
      noPrompt,
      commandMessages.getMessage('runtime.confirmDestructive.0', [String(String(flags.name))])
    );
    const deleteDlo = Boolean(flags['delete-dlo']);
    if (deleteDlo) {
      await this.confirmDestructive(noPrompt, commandMessages.getMessage('runtime.confirmDestructive.1'));
    }
    await client.delete(flags.name as string, deleteDlo);
    return { deleted: true, deleteDlo };
  }
}
