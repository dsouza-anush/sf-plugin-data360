import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { DataKitCommand, dataKitNameOptions, manifestRows } from '../../../dataKit/command.js';
import type { DataKitRecord } from '../../../dataKit/client.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.data-kit.manifest');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DataKitManifest extends DataKitCommand<{ items: DataKitRecord[] }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string(dataKitNameOptions(commandMessages.getMessage('flags.name.summary'))),
    timing: timingFlag,
  };

  public async run(): Promise<{ items: DataKitRecord[] }> {
    const { flags, client } = await this.initializeDataKit(DataKitManifest);
    const items = await client.manifest(flags.name as string);
    if (!this.jsonEnabled()) {
      this.table({ data: manifestRows(items), columns: ['entityName', 'developerName', 'id'] });
    }
    return { items };
  }
}
