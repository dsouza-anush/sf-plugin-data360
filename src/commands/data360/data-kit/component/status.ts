import { loadCommandMessages } from '../../../../messages.js';
import { Flags } from '@oclif/core';
import {
  DataKitCommand,
  componentNameOptions,
  componentStatusRows,
  dataKitNameOptions,
} from '../../../../dataKit/command.js';
import type { DataKitRecord } from '../../../../dataKit/client.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.data-kit.component.status');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DataKitComponentStatus extends DataKitCommand<{ item: DataKitRecord }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string(dataKitNameOptions(commandMessages.getMessage('flags.name.summary'))),
    component: Flags.string(componentNameOptions(commandMessages.getMessage('flags.component.summary'))),
    timing: timingFlag,
  };

  public async run(): Promise<{ item: DataKitRecord }> {
    const { flags, client } = await this.initializeDataKit(DataKitComponentStatus);
    const item = await client.status(flags.name as string, flags.component as string);
    if (!this.jsonEnabled()) {
      this.table({
        data: componentStatusRows(item),
        columns: ['componentId', 'dataKitName', 'status', 'code', 'message'],
      });
    }
    return { item };
  }
}
