import { loadCommandMessages } from '../../../messages.js';
import { access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Flags } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { Data360Command } from '../../../command/Data360Command.js';
import { resolveCreditNotices } from '../../../configMeta.js';
import { directClient, type IngestCacheEntry } from '../../../ingest/context.js';
import { IngestClient, mapIngestState, type IngestJob } from '../../../ingest/client.js';
import { splitCsvFiles } from '../../../ingest/csvChunks.js';
import { JobCache } from '../../../run/jobCache.js';
import { runJob } from '../../../run/jobRunner.js';
import { createJobProgress } from '../../../run/stages.js';
import { attachIngestJobError, failedRecordHint } from '../../../ingest/errors.js';
import { createCommandCancellation, type CommandCancellation } from '../../../run/cancellation.js';
import {
  apiVersionFlag,
  asyncFlag,
  ingestWaitFlag,
  noPromptFlag,
  objectNameFlag,
  sourceNameFlag,
  targetOrgFlag,
  timingFlag,
} from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.ingest.bulk');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class IngestBulk extends Data360Command<IngestJob> {
  public static cancellationFactory: () => CommandCancellation = () => createCommandCancellation();
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    'source-name': sourceNameFlag,
    'object-name': objectNameFlag,
    file: Flags.string({
      char: 'f',
      required: true,
      multiple: true,
      parse: async (value) => {
        await access(value);
        return value;
      },
      summary: commandMessages.getMessage('flags.file.summary'),
    }),
    operation: Flags.option({
      options: ['upsert', 'delete'] as const,
      default: 'upsert' as const,
      summary: commandMessages.getMessage('flags.operation.summary'),
    })(),
    wait: ingestWaitFlag,
    async: asyncFlag,
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };
  public async run(): Promise<IngestJob> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(IngestBulk),
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => flags.timing,
    });
    const { flags } = initialized.parsed;
    const username = flags['target-org'].getUsername()!;
    const apiVersion = flags['api-version'] ?? initialized.connection.version!;
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage(flags.operation === 'delete' ? 'prompt.delete' : 'prompt.upsert', [
        flags['object-name'],
        flags.file.length,
      ])
    );
    const cancellation = IngestBulk.cancellationFactory();
    let direct: Awaited<ReturnType<typeof directClient>>;
    try {
      direct = await directClient(flags['target-org'], initialized.connection, initialized.requestTiming);
    } catch (error) {
      cancellation.dispose();
      throw error;
    }
    const client = new IngestClient(direct.client);
    const progress = createJobProgress({
      title: commandMessages.getMessage('progress.title'),
      stages: commandMessages.getMessages('progress.stages'),
      jsonEnabled: this.jsonEnabled(),
      isTTY: Boolean(process.stderr.isTTY),
      ci: process.env.CI !== undefined,
      log: (message) => this.status(message),
    });
    let job: IngestJob | undefined;
    let failure: Error | undefined;
    if (!this.jsonEnabled() && (await resolveCreditNotices())) this.status(commandMessages.getMessage('notice.credit'));
    try {
      progress.goto('Create job');
      job = await client.create(flags['source-name'], flags['object-name'], flags.operation);
      try {
        progress.goto('Upload');
        let batches = 0;
        let uploadedBytes = 0;
        // Data 360 bulk-delete CSVs are headerless: the first row is a primary key, not a schema header.
        // https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-upload-job-data.html
        for await (const chunk of splitCsvFiles(flags.file, {
          preserveHeader: flags.operation === 'upsert',
          signal: cancellation.signal,
          tempRoot: cancellation.tempRoot,
        })) {
          batches += 1;
          if (batches > 100) {
            throw new SfError(
              commandMessages.getMessage('error.D360_INVALID_DEFINITION.3'),
              'D360_INVALID_DEFINITION',
              [commandMessages.getMessage('error.D360_INVALID_DEFINITION.3.actions.1')]
            );
          }
          await client.upload(job.id, () => createReadStream(chunk.path), cancellation.signal);
          uploadedBytes += chunk.bytes;
          progress.goto('Upload', `files=${batches} bytes=${uploadedBytes}`);
        }
        progress.goto('Close');
        job = await client.close(job.id);
      } catch (error) {
        const interrupted = cancellation.signal.aborted;
        try {
          await client.abort(job.id);
        } catch {
          // Preserve the upload error when a concurrent terminal transition prevents cleanup.
        }
        if (interrupted) {
          const interruption = new SfError(
            commandMessages.getMessage('error.D360_API_ERROR.4', [String(job.id)]),
            'D360_API_ERROR',
            [commandMessages.getMessage('error.D360_API_ERROR.4.actions.1', [String(job.id), String(username)])],
            130,
            error
          ) as SfError<{ jobId: string }>;
          interruption.data = { jobId: job.id };
          throw interruption;
        }
        throw attachIngestJobError(error as Error, job.id, [
          `Run sf data360 ingest report -i "${job.id}" --target-org "${username}" to inspect the aborted job.`,
          'Re-run sf data360 ingest bulk with the original files; uploads resume only after UploadComplete.',
        ]);
      }
      try {
        await (
          await JobCache.create<IngestCacheEntry>('ingest')
        ).save({
          id: job.id,
          username,
          apiVersion,
          startedAt: new Date().toISOString(),
          context: { sourceName: flags['source-name'], objectName: flags['object-name'] },
          outputInfo: { operation: flags.operation },
        });
      } catch (error) {
        throw attachIngestJobError(error as Error, job.id, [
          `Run sf data360 ingest report -i "${job.id}" --target-org "${username}" to inspect the closed job.`,
          `Run sf data360 ingest resume -i "${job.id}" --target-org "${username}" to continue waiting.`,
        ]);
      }
      if (flags.async || flags.wait.milliseconds === 0) {
        if (!this.jsonEnabled()) this.status(commandMessages.getMessage('hint.resume'));
        return job;
      }
      progress.goto('Processing');
      job = await runJob(() => client.status(job!.id), {
        timeoutMs: flags.wait.milliseconds,
        jobId: job.id,
        family: 'Ingestion job',
        resumeCommand: 'sf data360 ingest resume -r',
        failureAction: `Run sf data360 ingest report -i "${job.id}" to inspect the job.`,
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
      cancellation.dispose();
      await direct.close();
    }
  }
}
