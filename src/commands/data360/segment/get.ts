import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { SegmentCommand } from '../../../segment/command.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.segment.get');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class SegmentGet extends SegmentCommand<{ item: Record<string, unknown>; count?: unknown }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    'with-count': Flags.boolean({ summary: commandMessages.getMessage('flags.with-count.summary') }),
    timing: timingFlag,
  };

  public async run(): Promise<{ item: Record<string, unknown>; count?: unknown }> {
    const { flags, client } = await this.initializeSegment(SegmentGet);
    const key = await this.resolveKey(client, flags.name as string, 'idOrApiName');
    const response = await client.request<Record<string, unknown>>({
      method: 'GET',
      endpoint: `/segments/${encodeURIComponent(key)}`,
    });
    const item = this.unwrapSegment(response);
    if (!flags['with-count']) return { item };
    const apiName =
      typeof item.segmentApiName === 'string'
        ? item.segmentApiName
        : typeof item.apiName === 'string'
          ? item.apiName
          : await this.resolveKey(client, flags.name as string, 'apiName');
    return {
      item,
      count: await client.request({
        method: 'POST',
        endpoint: `/segments/${encodeURIComponent(apiName)}/actions/count`,
        body: {},
      }),
    };
  }
}
