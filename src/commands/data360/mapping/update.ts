import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { MappingCommand } from '../../../mapping/command.js';
import { loadDefinition } from '../../../shared/definitionFile.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.mapping.update');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class MappingUpdate extends MappingCommand<{ outcomes: Array<{ field: string; success: boolean }> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    file: Flags.string({ char: 'f', required: true, summary: commandMessages.getMessage('flags.file.summary') }),
    timing: timingFlag,
  };
  public async run(): Promise<{ outcomes: Array<{ field: string; success: boolean }> }> {
    const { flags, client } = await this.initializeMapping(MappingUpdate);
    const definition = await loadDefinition(flags.file as string);
    const fields = definition.fieldMappings ?? definition.fields;
    if (!Array.isArray(fields)) {
      throw new SfError(commandMessages.getMessage('error.D360_INVALID_DEFINITION.0'), 'D360_INVALID_DEFINITION', [
        commandMessages.getMessage('error.D360_INVALID_DEFINITION.0.actions.1'),
      ]);
    }
    const outcomes = await client.update(flags.name as string, fields as Array<Record<string, unknown>>);
    if (outcomes.some(({ success }) => !success)) process.exitCode = 68;
    if (!this.jsonEnabled()) this.table({ data: outcomes, columns: ['field', 'success'] });
    return { outcomes };
  }
}
