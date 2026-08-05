import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { ConnectionCommand } from '../../../connection/command.js';
import { connectionResource } from '../../../resources/connection.js';
import { csvCell } from '../../../ux/csv.js';
import {
  allFlag,
  apiVersionFlag,
  limitFlag,
  resultFormatFlag,
  targetOrgFlag,
  timingFlag,
} from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.connection.list');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class ConnectionList extends ConnectionCommand<{ items: Array<Record<string, unknown>> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    'connector-type': Flags.string({ summary: commandMessages.getMessage('flags.connector-type.summary') }),
    limit: limitFlag,
    all: allFlag,
    'result-format': resultFormatFlag,
    timing: timingFlag,
  };

  public async run(): Promise<{ items: Array<Record<string, unknown>> }> {
    const { flags, client } = await this.initializeConnection(ConnectionList);
    const items = await client.list(flags['connector-type'] as string | undefined);
    const selected = flags.all ? items : items.slice(0, flags.limit as number);
    if (!this.jsonEnabled() && flags['result-format'] === 'human') {
      this.table({ data: selected, columns: [...connectionResource.columns] });
    } else if (!this.jsonEnabled() && flags['result-format'] === 'json') {
      process.stdout.write(`${JSON.stringify(selected, undefined, 2)}\n`);
    } else if (!this.jsonEnabled()) {
      const columns = connectionResource.columns;
      process.stdout.write(
        `${[columns, ...selected.map((item) => columns.map((column) => item[column]))]
          .map((row) => row.map(csvCell).join(','))
          .join('\r\n')}\r\n`
      );
    }
    return { items: selected };
  }
}
