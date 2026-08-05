import { loadCommandMessages } from '../../../../messages.js';
import { Flags } from '@oclif/core';
import { DataKitCommand, componentNameOptions, dataKitNameOptions } from '../../../../dataKit/command.js';
import { DEPENDENCY_COMPONENT_TYPES, type DataKitRecord } from '../../../../dataKit/client.js';
import { apiVersionFlag, dataSpaceFlag, targetOrgFlag, timingFlag } from '../../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.data-kit.component.dependencies');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DataKitComponentDependencies extends DataKitCommand<{ items: DataKitRecord[] }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string(dataKitNameOptions(commandMessages.getMessage('flags.name.summary'))),
    component: Flags.string(componentNameOptions(commandMessages.getMessage('flags.component.summary'))),
    'component-type': Flags.option({
      required: true,
      options: DEPENDENCY_COMPONENT_TYPES,
      summary: commandMessages.getMessage('flags.component-type.summary'),
    })(),
    'data-space': dataSpaceFlag,
    timing: timingFlag,
  };

  public async run(): Promise<{ items: DataKitRecord[] }> {
    const { flags, client } = await this.initializeDataKit(DataKitComponentDependencies);
    const items = await client.dependencies({
      dataKitName: flags.name as string,
      componentName: flags.component as string,
      componentType: flags['component-type'] as (typeof DEPENDENCY_COMPONENT_TYPES)[number],
      dataspace: flags['data-space'] as string | undefined,
    });
    if (!this.jsonEnabled()) this.table({ data: items, columns: ['id', 'name', 'type'] });
    return { items };
  }
}
