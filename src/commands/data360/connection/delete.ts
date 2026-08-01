import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { ConnectionCommand } from '../../../connection/command.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.connection.delete');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class ConnectionDelete extends ConnectionCommand<{ deleted: true; id: string }> {
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

  public async run(): Promise<{ deleted: true; id: string }> {
    const { flags, client } = await this.initializeConnection(ConnectionDelete);
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('runtime.confirmDestructive.0', [String(String(flags.name))])
    );
    return { deleted: true, id: await client.delete(flags.name as string) };
  }
}
