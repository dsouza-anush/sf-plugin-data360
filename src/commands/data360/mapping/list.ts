import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { MappingCommand } from '../../../mapping/command.js';
import {
  allFlag,
  apiVersionFlag,
  limitFlag,
  resultFormatFlag,
  targetOrgFlag,
  timingFlag,
} from '../../../shared/flags.js';
import { csvCell } from '../../../ux/csv.js';

const commandMessages = loadCommandMessages('data360.mapping.list');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class MappingList extends MappingCommand<{ items: Array<Record<string, unknown>> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    dmo: Flags.string({ summary: commandMessages.getMessage('flags.dmo.summary') }),
    'source-object': Flags.string({ summary: commandMessages.getMessage('flags.source-object.summary') }),
    all: allFlag,
    limit: limitFlag,
    'result-format': resultFormatFlag,
    timing: timingFlag,
  };

  public async run(): Promise<{ items: Array<Record<string, unknown>> }> {
    const { flags, client } = await this.initializeMapping(MappingList);
    if (!flags.dmo) {
      throw new SfError(commandMessages.getMessage('error.D360_INVALID_DEFINITION.0'), 'D360_INVALID_DEFINITION', [
        commandMessages.getMessage('error.D360_INVALID_DEFINITION.0.actions.1'),
      ]);
    }
    const values = await client.list({
      dmo: flags.dmo as string | undefined,
      sourceObject: flags['source-object'] as string | undefined,
      limit: flags.all ? undefined : (flags.limit as number),
    });
    const normalized: Array<Record<string, unknown>> = values.map((item) => ({
      ...item,
      'fieldMappings#': Array.isArray(item.fieldMappings) ? item.fieldMappings.length : 0,
    }));
    const items = flags.all ? normalized : normalized.slice(0, flags.limit as number);
    const columns = [
      'developerName',
      'sourceEntityDeveloperName',
      'targetEntityDeveloperName',
      'status',
      'fieldMappings#',
    ];
    if (!this.jsonEnabled() && flags['result-format'] === 'human') this.table({ data: items, columns: [...columns] });
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
