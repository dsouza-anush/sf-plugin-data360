import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { TransformCommand } from '../../../transform/command.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.transform.report');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class TransformReport extends TransformCommand<{ item: Record<string, unknown>; history?: unknown }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    history: Flags.boolean({ summary: commandMessages.getMessage('flags.history.summary') }),
    timing: timingFlag,
  };
  public async run(): Promise<{ item: Record<string, unknown>; history?: unknown }> {
    const { flags, client } = await this.initializeTransform(TransformReport);
    const key = await this.resolveKey(client, '/data-transforms', 'dataTransforms', flags.name as string);
    const base = `/data-transforms/${encodeURIComponent(key)}`;
    const item = await client.request<Record<string, unknown>>({
      method: 'POST',
      endpoint: `${base}/actions/refresh-status`,
    });
    const history = flags.history
      ? await client.request({ method: 'GET', endpoint: `${base}/run-history` })
      : undefined;
    return { item, history };
  }
}
