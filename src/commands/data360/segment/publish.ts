import { loadCommandMessages } from '../../../messages.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { Flags } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { resolveCreditNotices } from '../../../configMeta.js';
import { SegmentCommand } from '../../../segment/command.js';
import { billableNotice } from '../../../shared/billableNotice.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag, waitFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.segment.publish');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class SegmentPublish extends SegmentCommand<{
  item: Record<string, unknown>;
  segment?: Record<string, unknown>;
}> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    wait: waitFlag,
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };

  public async run(): Promise<{ item: Record<string, unknown>; segment?: Record<string, unknown> }> {
    const { flags, client } = await this.initializeSegment(SegmentPublish);
    if (!this.jsonEnabled() && (await resolveCreditNotices())) this.status(billableNotice('Segmentation & Activation'));
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('runtime.confirmDestructive', [String(flags.name)])
    );
    const id = await this.resolveKey(client, flags.name as string, 'id');
    const item = await client.request<Record<string, unknown>>({
      method: 'POST',
      endpoint: `/segments/${encodeURIComponent(id)}/actions/publish`,
      body: {},
    });
    const wait = flags.wait as { milliseconds: number } | undefined;
    if (!wait || wait.milliseconds === 0) return { item };
    const deadline = Date.now() + wait.milliseconds;
    do {
      const response = await client.request<Record<string, unknown>>({
        method: 'GET',
        endpoint: `/segments/${encodeURIComponent(id)}`,
      });
      const segment = this.unwrapSegment(response);
      const status = String(segment.publishStatus ?? segment.segmentStatus ?? '').toUpperCase();
      if (['PUBLISHED', 'ACTIVE', 'SUCCEEDED', 'SUCCESS'].includes(status)) return { item, segment };
      if (['FAILED', 'ERROR'].includes(status)) {
        throw new SfError(commandMessages.getMessage('error.D360_JOB_FAILED.1', [String(status)]), 'D360_JOB_FAILED', [
          commandMessages.getMessage('error.D360_JOB_FAILED.1.actions.1', [String(String(flags.name))]),
        ]);
      }
      if (Date.now() < deadline) await sleep(Math.min(1000, Math.max(0, deadline - Date.now())));
    } while (Date.now() < deadline);
    throw new SfError(
      commandMessages.getMessage('error.D360_JOB_TIMEOUT.2'),
      'D360_JOB_TIMEOUT',
      [commandMessages.getMessage('error.D360_JOB_TIMEOUT.2.actions.1', [String(String(flags.name))])],
      69
    );
  }
}
