import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { DataKitCommand, dataKitRows } from '../../../dataKit/command.js';
import type { DataKitRecord } from '../../../dataKit/client.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.data-kit.list');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DataKitList extends DataKitCommand<{ items: DataKitRecord[] }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    namespace: Flags.string({ summary: commandMessages.getMessage('flags.namespace.summary') }),
    timing: timingFlag,
  };

  public async run(): Promise<{ items: DataKitRecord[] }> {
    const { flags, client } = await this.initializeDataKit(DataKitList);
    const items = await client.list(flags.namespace as string | undefined);
    if (!this.jsonEnabled()) {
      this.table({
        data: dataKitRows(items),
        columns: ['developerName', 'label', 'components#', 'publishingSequence#'],
      });
    }
    return { items };
  }
}
