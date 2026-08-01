import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { DataKitCommand, dataKitNameOptions, definitionFileOptions } from '../../../dataKit/command.js';
import type { DataKitAsyncResult } from '../../../dataKit/client.js';
import { apiVersionFlag, dataSpaceFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';
import { loadDefinition } from '../../../shared/definitionFile.js';

const commandMessages = loadCommandMessages('data360.data-kit.deploy');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const validateDeployDefinition = (definition: Record<string, unknown>): Record<string, unknown> => {
  const components = definition.components;
  let detail: string | undefined;
  if (!Array.isArray(components) || components.length === 0) {
    detail = '`components` must be a non-empty array';
  } else {
    const invalidIndex = components.findIndex(
      (component) =>
        !isRecord(component) ||
        typeof component.type !== 'string' ||
        component.type.length === 0 ||
        !isRecord(component.config)
    );
    if (invalidIndex >= 0)
      detail = `components[${invalidIndex}] must contain a non-empty \`type\` and a \`config\` object`;
  }

  if (detail) {
    throw new SfError(
      commandMessages.getMessage('error.D360_INVALID_DEFINITION', [detail]),
      'D360_INVALID_DEFINITION',
      [commandMessages.getMessage('error.D360_INVALID_DEFINITION.actions')]
    );
  }
  return definition;
};

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DataKitDeploy extends DataKitCommand<DataKitAsyncResult> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string(dataKitNameOptions(commandMessages.getMessage('flags.name.summary'))),
    file: Flags.string(definitionFileOptions(commandMessages.getMessage('flags.file.summary'))),
    'data-space': dataSpaceFlag,
    timing: timingFlag,
  };

  public async run(): Promise<DataKitAsyncResult> {
    const { flags, client, username } = await this.initializeDataKit(DataKitDeploy);
    const name = flags.name as string;
    const item = await client.deploy(
      name,
      validateDeployDefinition(await loadDefinition(flags.file as string)),
      flags['data-space'] as string | undefined
    );
    return this.asyncResult(item, commandMessages.getMessage('runtime.continuation', [name, username]));
  }
}
