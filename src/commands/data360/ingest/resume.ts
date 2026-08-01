import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { Data360Command } from '../../../command/Data360Command.js';
import { IngestClient, mapIngestState, type IngestJob } from '../../../ingest/client.js';
import { directClient, resolveIngestJob } from '../../../ingest/context.js';
import { runJob } from '../../../run/jobRunner.js';
import { createJobProgress } from '../../../run/stages.js';
import { failedRecordHint } from '../../../ingest/errors.js';
import {
  apiVersionFlag,
  ingestWaitFlag,
  optionalTargetOrgFlag,
  timingFlag,
  useMostRecentFlag,
} from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.ingest.resume');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class IngestResume extends Data360Command<IngestJob> {
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
    wait: ingestWaitFlag,
    timing: timingFlag,
  };
  public async run(): Promise<IngestJob> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(IngestResume),
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
    const progress = createJobProgress({
      title: 'Data 360 bulk ingest',
      stages: ['Processing', 'Done'],
      jsonEnabled: this.jsonEnabled(),
      isTTY: Boolean(process.stderr.isTTY),
      ci: process.env.CI !== undefined,
      log: (message) => this.status(message),
    });
    let failure: Error | undefined;
    try {
      progress.goto('Processing');
      const client = new IngestClient(direct.client);
      const job = await runJob(() => client.status(initialized.connection.id), {
        timeoutMs: initialized.parsed.flags.wait.milliseconds,
        jobId: initialized.connection.id,
        family: 'Ingestion job',
        resumeCommand: 'sf data360 ingest resume -r',
        failureAction: `Run sf data360 ingest report -i "${initialized.connection.id}" to inspect the job.`,
        map: mapIngestState,
        onStatus: (status) =>
          progress.goto(
            'Processing',
            `state=${status.state} processed=${status.recordsProcessed ?? 0} failed=${status.recordsFailed ?? 0}`
          ),
      });
      progress.goto('Done');
      if ((job.recordsFailed ?? 0) > 0) {
        process.exitCode = 68;
        if (!this.jsonEnabled()) this.status(failedRecordHint(job.id));
      }
      return job;
    } catch (error) {
      failure = error as Error;
      throw error;
    } finally {
      progress.stop(failure);
      await direct.close();
    }
  }
}
