import { loadCommandMessages } from '../../../messages.js';
import { createReadStream } from 'node:fs';
import { Data360Command } from '../../../command/Data360Command.js';
import { directClient } from '../../../ingest/context.js';
import { IngestClient } from '../../../ingest/client.js';
import { chunkIngestRecords } from '../../../ingest/recordChunks.js';
import {
  apiVersionFlag,
  fileFlag,
  objectNameFlag,
  sourceNameFlag,
  targetOrgFlag,
  timingFlag,
} from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.ingest.validate');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class IngestValidate extends Data360Command<{ valid: true; records: number }> {
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
    timing: timingFlag,
  };
  public async run(): Promise<{ valid: true; records: number }> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(IngestValidate),
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => flags.timing,
    });
    const { flags } = initialized.parsed;
    const direct = await directClient(flags['target-org'], initialized.connection, initialized.requestTiming);
    let records = 0;
    try {
      const input = flags.file && flags.file !== '-' ? createReadStream(flags.file) : process.stdin;
      const client = new IngestClient(direct.client);
      for await (const payload of chunkIngestRecords(input)) {
        await client.validate(flags['source-name'], flags['object-name'], payload);
        records += payload.data.length;
      }
    } finally {
      await direct.close();
    }
    return { valid: true, records };
  }
}
