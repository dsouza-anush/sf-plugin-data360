import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { Data360Command } from '../../../command/Data360Command.js';
import { cancelIngestJob, IngestClient, type IngestCancelResult } from '../../../ingest/client.js';
import { directClient, resolveIngestJob } from '../../../ingest/context.js';
import {
  apiVersionFlag,
  noPromptFlag,
  optionalTargetOrgFlag,
  timingFlag,
  useMostRecentFlag,
} from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.ingest.cancel');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class IngestCancel extends Data360Command<IngestCancelResult> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': optionalTargetOrgFlag,
    'api-version': apiVersionFlag,
    'job-id': Flags.string({
      char: 'i',
      exactlyOne: ['job-id', 'use-most-recent'],
      summary: commandMessages.getMessage('flags.job-id.summary'),
    }),
    'use-most-recent': useMostRecentFlag,
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };
  public async run(): Promise<IngestCancelResult> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(IngestCancel),
      connect: async ({ flags, raw }) =>
        resolveIngestJob({
          id: flags['job-id'],
          recent: flags['use-most-recent'],
          org: flags['target-org'],
          orgExplicit: raw.some((token) => token.type === 'flag' && token.flag === 'target-org'),
          apiVersion: flags['api-version'],
        }),
      timingSelected: ({ flags }) => flags.timing,
    });
    const { flags } = initialized.parsed;
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('prompt.cancel', [initialized.connection.id])
    );
    const direct = await directClient(
      initialized.connection.org,
      initialized.connection.connection,
      initialized.requestTiming
    );
    try {
      return cancelIngestJob(new IngestClient(direct.client), initialized.connection.id);
    } finally {
      await direct.close();
    }
  }
}
