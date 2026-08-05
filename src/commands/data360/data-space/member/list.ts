import { loadCommandMessages } from '../../../../messages.js';
import { Flags } from '@oclif/core';
import { TransformCommand } from '../../../../transform/command.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.data-space.member.list');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DataSpaceMemberList extends TransformCommand<{ items: Array<Record<string, unknown>> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    timing: timingFlag,
  };
  public async run(): Promise<{ items: Array<Record<string, unknown>> }> {
    const { flags, client } = await this.initializeTransform(DataSpaceMemberList);
    const key = await this.resolveKey(client, '/data-spaces', 'dataSpaces', flags.name as string);
    const response = await client.request<Record<string, unknown>>({
      method: 'GET',
      endpoint: `/data-spaces/${encodeURIComponent(key)}/members`,
    });
    return { items: Array.isArray(response.members) ? (response.members as Array<Record<string, unknown>>) : [] };
  }
}
