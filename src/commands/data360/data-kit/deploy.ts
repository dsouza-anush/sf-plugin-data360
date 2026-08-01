import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { DataKitCommand, dataKitNameOptions, definitionFileOptions } from '../../../dataKit/command.js';
import type { DataKitAsyncResult } from '../../../dataKit/client.js';
import { apiVersionFlag, dataSpaceFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';
import { loadDefinition } from '../../../shared/definitionFile.js';

const commandMessages = loadCommandMessages('data360.data-kit.deploy');

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
      await loadDefinition(flags.file as string),
      flags['data-space'] as string | undefined
    );
    return this.asyncResult(item, commandMessages.getMessage('runtime.continuation', [name, username]));
  }
}
