import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { ProfileCommand } from '../../../profile/command.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.profile.lookup');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class ProfileLookup extends ProfileCommand<{ item: Record<string, unknown> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    entity: Flags.string({ required: true, summary: commandMessages.getMessage('flags.entity.summary') }),
    'data-source': Flags.string({ required: true, summary: commandMessages.getMessage('flags.data-source.summary') }),
    'data-source-object': Flags.string({
      required: true,
      summary: commandMessages.getMessage('flags.data-source-object.summary'),
    }),
    record: Flags.string({ required: true, summary: commandMessages.getMessage('flags.record.summary') }),
    timing: timingFlag,
  };
  public async run(): Promise<{ item: Record<string, unknown> }> {
    const { flags, client } = await this.initializeProfile(ProfileLookup);
    const parts = [flags.entity, flags['data-source'], flags['data-source-object'], flags.record].map((value) =>
      encodeURIComponent(value as string)
    );
    return {
      item: await client.request({
        method: 'GET',
        endpoint: `/universalIdLookup/${parts.join('/')}`,
      }),
    };
  }
}
