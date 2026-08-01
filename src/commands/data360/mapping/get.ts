import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { MappingCommand } from '../../../mapping/command.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.mapping.get');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class MappingGet extends MappingCommand<{ item: Record<string, unknown> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', summary: commandMessages.getMessage('flags.name.summary') }),
    dmo: Flags.string({ summary: commandMessages.getMessage('flags.dmo.summary') }),
    'source-object': Flags.string({ summary: commandMessages.getMessage('flags.source-object.summary') }),
    timing: timingFlag,
  };
  public async run(): Promise<{ item: Record<string, unknown> }> {
    const { flags, client } = await this.initializeMapping(MappingGet);
    const name = flags.name as string | undefined;
    const dmo = flags.dmo as string | undefined;
    const sourceObject = flags['source-object'] as string | undefined;
    if (name && (dmo || sourceObject)) {
      throw new SfError(commandMessages.getMessage('error.D360_INVALID_DEFINITION.0'), 'D360_INVALID_DEFINITION', [
        commandMessages.getMessage('error.D360_INVALID_DEFINITION.0.actions.1'),
      ]);
    }
    if (!name && !dmo) {
      throw new SfError(commandMessages.getMessage('error.D360_INVALID_DEFINITION.1'), 'D360_INVALID_DEFINITION', [
        commandMessages.getMessage('error.D360_INVALID_DEFINITION.1.actions.1'),
      ]);
    }
    return { item: name ? await client.get(name) : await client.resolve({ dmo: dmo!, sourceObject }) };
  }
}
