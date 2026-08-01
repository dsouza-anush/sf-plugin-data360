import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { DataKitCommand, componentRows } from '../../../dataKit/command.js';
import { AVAILABLE_COMPONENT_TYPES, type DataKitRecord } from '../../../dataKit/client.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.data-kit.available');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DataKitAvailable extends DataKitCommand<{ items: DataKitRecord[] }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    'component-type': Flags.option({
      options: AVAILABLE_COMPONENT_TYPES,
      required: true,
      summary: commandMessages.getMessage('flags.component-type.summary'),
    })(),
    'data-kit': Flags.string({ required: true, summary: commandMessages.getMessage('flags.data-kit.summary') }),
    limit: Flags.integer({
      default: 200,
      min: 1,
      max: 200,
      summary: commandMessages.getMessage('flags.limit.summary'),
    }),
    offset: Flags.integer({
      default: 0,
      min: 0,
      summary: commandMessages.getMessage('flags.offset.summary'),
    }),
    timing: timingFlag,
  };

  public async run(): Promise<{ items: DataKitRecord[] }> {
    const { flags, client } = await this.initializeDataKit(DataKitAvailable);
    const items = await client.available({
      componentType: flags['component-type'] as (typeof AVAILABLE_COMPONENT_TYPES)[number],
      dataKitDevName: flags['data-kit'] as string,
      limit: flags.limit as number,
      offset: flags.offset as number,
    });
    if (!this.jsonEnabled()) {
      this.table({ data: componentRows(items), columns: ['type', 'name', 'label', 'connectorType'] });
    }
    return { items };
  }
}
