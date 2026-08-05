import { loadCommandMessages } from '../../../../messages.js';
import { Flags } from '@oclif/core';
import { DmoCommand } from '../../../../dmo/command.js';
import {
  allFlag,
  apiVersionFlag,
  limitFlag,
  resultFormatFlag,
  targetOrgFlag,
  timingFlag,
} from '../../../../shared/flags.js';
import { csvCell } from '../../../../ux/csv.js';

const commandMessages = loadCommandMessages('data360.dmo.relationship.list');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DmoRelationshipList extends DmoCommand<{ items: Array<Record<string, unknown>> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    all: allFlag,
    limit: limitFlag,
    'result-format': resultFormatFlag,
    timing: timingFlag,
  };

  public async run(): Promise<{ items: Array<Record<string, unknown>> }> {
    const { flags, client } = await this.initializeDmo(DmoRelationshipList);
    const items = await client.listRelationships(flags.name as string, {
      all: Boolean(flags.all),
      limit: flags.limit as number,
    });
    const columns = ['name', 'label', 'type', 'status'];
    if (!this.jsonEnabled() && flags['result-format'] === 'human') this.table({ data: items, columns });
    else if (!this.jsonEnabled() && flags['result-format'] === 'json')
      process.stdout.write(`${JSON.stringify(items, undefined, 2)}\n`);
    else if (!this.jsonEnabled())
      process.stdout.write(
        `${[columns, ...items.map((item) => columns.map((column) => item[column] ?? ''))]
          .map((row) => row.map(csvCell).join(','))
          .join('\r\n')}\r\n`
      );
    return { items };
  }
}
