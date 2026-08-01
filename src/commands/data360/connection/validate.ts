import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { ConnectionCommand } from '../../../connection/command.js';
import { loadDefinition } from '../../../shared/definitionFile.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.connection.validate');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class ConnectionValidate extends ConnectionCommand<{ result: Record<string, unknown> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({
      char: 'n',
      exactlyOne: ['name', 'file'],
      summary: commandMessages.getMessage('flags.name.summary'),
    }),
    file: Flags.string({
      char: 'f',
      exactlyOne: ['name', 'file'],
      summary: commandMessages.getMessage('flags.file.summary'),
    }),
    timing: timingFlag,
  };

  public async run(): Promise<{ result: Record<string, unknown> }> {
    const { flags, client } = await this.initializeConnection(ConnectionValidate);
    const result = flags.name
      ? await client.validateExisting(flags.name as string)
      : await client.validateCandidate(await loadDefinition(flags.file as string));
    if (!this.jsonEnabled()) this.table({ data: [result], columns: Object.keys(result) });
    return { result };
  }
}
