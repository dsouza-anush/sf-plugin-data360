import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { DataKitCommand, dataKitNameOptions } from '../../../dataKit/command.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.data-kit.delete');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DataKitDelete extends DataKitCommand<{ deleted: true; name: string }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string(dataKitNameOptions(commandMessages.getMessage('flags.name.summary'))),
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };

  public async run(): Promise<{ deleted: true; name: string }> {
    const { flags, client } = await this.initializeDataKit(DataKitDelete);
    const name = flags.name as string;
    await this.confirmDestructive(Boolean(flags['no-prompt']), commandMessages.getMessage('prompt.delete', [name]));
    await client.delete(name);
    return { deleted: true, name };
  }
}
