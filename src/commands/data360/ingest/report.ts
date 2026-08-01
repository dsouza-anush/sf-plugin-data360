import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { Data360Command } from '../../../command/Data360Command.js';
import { IngestClient, type IngestJob } from '../../../ingest/client.js';
import { directClient, resolveIngestJob } from '../../../ingest/context.js';
import { apiVersionFlag, optionalTargetOrgFlag, timingFlag, useMostRecentFlag } from '../../../shared/flags.js';
import { failedRecordHint } from '../../../ingest/errors.js';

const commandMessages = loadCommandMessages('data360.ingest.report');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class IngestReport extends Data360Command<IngestJob> {
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
    timing: timingFlag,
  };
  public async run(): Promise<IngestJob> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(IngestReport),
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
    const direct = await directClient(
      initialized.connection.org,
      initialized.connection.connection,
      initialized.requestTiming
    );
    try {
      const job = await new IngestClient(direct.client).status(initialized.connection.id);
      if (!this.jsonEnabled())
        this.table({
          data: [job],
          columns: ['id', 'state', 'recordsProcessed', 'recordsFailed', 'createdDate', 'lastModifiedDate'],
        });
      if (job.state.toLowerCase() === 'jobcomplete' && (job.recordsFailed ?? 0) > 0) {
        process.exitCode = 68;
        if (!this.jsonEnabled()) this.status(failedRecordHint(job.id));
      }
      return job;
    } finally {
      await direct.close();
    }
  }
}
