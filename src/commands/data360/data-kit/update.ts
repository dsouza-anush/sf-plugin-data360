import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { DataKitCommand, dataKitNameOptions, dataKitRows, definitionFileOptions } from '../../../dataKit/command.js';
import type { DataKitRecord } from '../../../dataKit/client.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';
import { loadDefinition } from '../../../shared/definitionFile.js';

const commandMessages = loadCommandMessages('data360.data-kit.update');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DataKitUpdate extends DataKitCommand<{ item: DataKitRecord }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string(dataKitNameOptions(commandMessages.getMessage('flags.name.summary'))),
    file: Flags.string(definitionFileOptions(commandMessages.getMessage('flags.file.summary'))),
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };

  public async run(): Promise<{ item: DataKitRecord }> {
    const { flags, client } = await this.initializeDataKit(DataKitUpdate);
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('prompt.update', [String(flags.name)])
    );
    const item = await client.update(flags.name as string, await loadDefinition(flags.file as string));
    if (!this.jsonEnabled()) {
      this.table({ data: dataKitRows([item]), columns: ['developerName', 'label', 'components#'] });
    }
    return { item };
  }
}
