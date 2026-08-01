import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { ConnectionCommand } from '../../../connection/command.js';
import { loadDefinition } from '../../../shared/definitionFile.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.connection.create');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class ConnectionCreate extends ConnectionCommand<{ item: Record<string, unknown> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    file: Flags.string({ char: 'f', required: true, summary: commandMessages.getMessage('flags.file.summary') }),
    timing: timingFlag,
  };

  public async run(): Promise<{ item: Record<string, unknown> }> {
    const { flags, client } = await this.initializeConnection(ConnectionCreate);
    const item = await client.create(await loadDefinition(flags.file as string));
    if (!this.jsonEnabled()) this.table({ data: [item], columns: Object.keys(item) });
    return { item };
  }
}
