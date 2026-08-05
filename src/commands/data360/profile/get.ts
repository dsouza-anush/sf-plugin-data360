import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { ProfileCommand } from '../../../profile/command.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.profile.get');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class ProfileGet extends ProfileCommand<{ item: Record<string, unknown> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    id: Flags.string({ exclusive: ['search-key'], summary: commandMessages.getMessage('flags.id.summary') }),
    'search-key': Flags.string({ exclusive: ['id'], summary: commandMessages.getMessage('flags.search-key.summary') }),
    fields: Flags.string({ summary: commandMessages.getMessage('flags.fields.summary') }),
    insight: Flags.string({ dependsOn: ['id'], summary: commandMessages.getMessage('flags.insight.summary') }),
    timing: timingFlag,
  };
  public async run(): Promise<{ item: Record<string, unknown> }> {
    const { flags, client } = await this.initializeProfile(ProfileGet);
    const model = encodeURIComponent(flags.name as string);
    const id = flags.id as string | undefined;
    const insight = flags.insight as string | undefined;
    const endpoint = insight
      ? `/profile/${model}/${encodeURIComponent(id!)}/calculated-insights/${encodeURIComponent(insight)}`
      : `/profile/${model}${id ? `/${encodeURIComponent(id)}` : ''}`;
    return {
      item: await client.request({
        method: 'GET',
        endpoint,
        query: id
          ? undefined
          : {
              searchKey: flags['search-key'] as string | undefined,
              fields: flags.fields as string | undefined,
            },
      }),
    };
  }
}
