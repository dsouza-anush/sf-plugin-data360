import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { ConnectionCommand } from '../../../connection/command.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.connection.get');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class ConnectionGet extends ConnectionCommand<{ item: Record<string, unknown> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    timing: timingFlag,
  };

  public async run(): Promise<{ item: Record<string, unknown> }> {
    const { flags, client } = await this.initializeConnection(ConnectionGet);
    const item = await client.get(flags.name as string);
    if (!this.jsonEnabled()) this.table({ data: [item], columns: Object.keys(item) });
    return { item };
  }
}
