import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { MappingCommand } from '../../../mapping/command.js';
import { loadDefinition } from '../../../shared/definitionFile.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.mapping.create');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class MappingCreate extends MappingCommand<Record<string, unknown>> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    file: Flags.string({
      char: 'f',
      exactlyOne: ['file', 'auto'],
      summary: commandMessages.getMessage('flags.file.summary'),
    }),
    auto: Flags.boolean({ exactlyOne: ['file', 'auto'], summary: commandMessages.getMessage('flags.auto.summary') }),
    dlo: Flags.string({ dependsOn: ['auto'], summary: commandMessages.getMessage('flags.dlo.summary') }),
    dmo: Flags.string({ dependsOn: ['auto'], summary: commandMessages.getMessage('flags.dmo.summary') }),
    'dry-run': Flags.boolean({ dependsOn: ['auto'], summary: commandMessages.getMessage('flags.dry-run.summary') }),
    timing: timingFlag,
  };
  public async run(): Promise<Record<string, unknown>> {
    const { flags, client } = await this.initializeMapping(MappingCreate);
    if (flags.auto) {
      if (!flags.dlo || !flags.dmo) {
        throw new SfError(commandMessages.getMessage('error.D360_INVALID_DEFINITION.0'), 'D360_INVALID_DEFINITION', [
          commandMessages.getMessage('error.D360_INVALID_DEFINITION.0.actions.1'),
        ]);
      }
      const result = await client.auto(flags.dlo as string, flags.dmo as string, Boolean(flags['dry-run']));
      if (!this.jsonEnabled()) {
        this.table({
          data: result.mappings,
          columns: ['sourceFieldDeveloperName', 'targetFieldDeveloperName', 'matchType'],
        });
      }
      return result;
    }
    return { item: await client.create(await loadDefinition(flags.file as string)) };
  }
}
