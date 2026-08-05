import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { MappingCommand } from '../../../mapping/command.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.mapping.delete');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class MappingDelete extends MappingCommand<{ deleted: true; name: string; fields?: string[] }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    fields: Flags.string({ summary: commandMessages.getMessage('flags.fields.summary') }),
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };
  public async run(): Promise<{ deleted: true; name: string; fields?: string[] }> {
    const { flags, client } = await this.initializeMapping(MappingDelete);
    const fields =
      flags.fields === undefined
        ? undefined
        : String(flags.fields)
            .split(',')
            .map((field) => field.trim())
            .filter(Boolean);
    if (fields?.length === 0) {
      throw new SfError(commandMessages.getMessage('error.D360_INVALID_DEFINITION'), 'D360_INVALID_DEFINITION', [
        commandMessages.getMessage('error.D360_INVALID_DEFINITION.actions'),
      ]);
    }
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('runtime.confirmDestructive.0', [String(String(flags.name))])
    );
    await client.delete(flags.name as string, fields);
    return { deleted: true, name: flags.name as string, fields };
  }
}
