import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { DataKitCommand, dataKitRows, definitionFileOptions } from '../../../dataKit/command.js';
import type { DataKitRecord } from '../../../dataKit/client.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';
import { loadDefinition } from '../../../shared/definitionFile.js';

const commandMessages = loadCommandMessages('data360.data-kit.create');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DataKitCreate extends DataKitCommand<{ item: DataKitRecord }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    file: Flags.string(definitionFileOptions(commandMessages.getMessage('flags.file.summary'))),
    timing: timingFlag,
  };

  public async run(): Promise<{ item: DataKitRecord }> {
    const { flags, client } = await this.initializeDataKit(DataKitCreate);
    const item = await client.create(await loadDefinition(flags.file as string));
    if (!this.jsonEnabled()) {
      this.table({ data: dataKitRows([item]), columns: ['developerName', 'label', 'components#'] });
    }
    return { item };
  }
}
