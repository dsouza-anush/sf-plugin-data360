import { createReadStream } from 'node:fs';
import { Data360Command } from '../../command/Data360Command.js';
import { loadCommandMessages } from '../../messages.js';
import {
  apiVersionFlag,
  fileFlag,
  noPromptFlag,
  objectNameFlag,
  sourceNameFlag,
  targetOrgFlag,
  timingFlag,
} from '../../shared/flags.js';
import { chunkIngestRecords } from '../../ingest/recordChunks.js';
import { directClient } from '../../ingest/context.js';
import { IngestClient } from '../../ingest/client.js';
import { resolveCreditNotices } from '../../configMeta.js';

const commandMessages = loadCommandMessages('data360.ingest');

export type StreamIngestResult = { accepted: number; batches: number };

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class Ingest extends Data360Command<StreamIngestResult> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    'source-name': sourceNameFlag,
    'object-name': objectNameFlag,
    file: fileFlag,
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };

  public async run(): Promise<StreamIngestResult> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(Ingest),
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => flags.timing,
    });
    const { flags } = initialized.parsed;
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('prompt.ingest', [flags['object-name']])
    );
    const direct = await directClient(flags['target-org'], initialized.connection, initialized.requestTiming);
    let accepted = 0;
    let batches = 0;
    if (!this.jsonEnabled() && (await resolveCreditNotices())) this.status(commandMessages.getMessage('notice.credit'));
    try {
      const input = flags.file && flags.file !== '-' ? createReadStream(flags.file) : process.stdin;
      const client = new IngestClient(direct.client);
      for await (const payload of chunkIngestRecords(input)) {
        await client.stream(flags['source-name'], flags['object-name'], payload);
        accepted += payload.data.length;
        batches += 1;
      }
    } finally {
      await direct.close();
    }
    if (!this.jsonEnabled()) this.status(commandMessages.getMessage('notice.consistency'));
    return { accepted, batches };
  }
}
