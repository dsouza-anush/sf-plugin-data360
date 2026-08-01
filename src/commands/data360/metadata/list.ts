import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { resolveCommandDataSpace } from '../../../configMeta.js';
import { Data360Command } from '../../../command/Data360Command.js';
import { SsotClient } from '../../../client/ssotClient.js';
import { MetadataClient } from '../../../metadata/client.js';
import { metadataListRows } from '../../../metadata/output.js';
import type { MetadataListResult } from '../../../metadata/types.js';
import { csvCell } from '../../../ux/csv.js';
import {
  allFlag,
  apiVersionFlag,
  dataSpaceFlag,
  limitFlag,
  resultFormatFlag,
  targetOrgFlag,
  timingFlag,
} from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.metadata.list');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class MetadataList extends Data360Command<MetadataListResult> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    'data-space': dataSpaceFlag,
    'entity-type': Flags.string({
      summary: commandMessages.getMessage('flags.entity-type.summary'),
    }),
    'entity-category': Flags.string({
      summary: commandMessages.getMessage('flags.entity-category.summary'),
    }),
    limit: limitFlag,
    all: allFlag,
    'result-format': resultFormatFlag,
    timing: timingFlag,
  };

  public async run(): Promise<MetadataListResult> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(MetadataList),
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => flags.timing,
    });
    const { flags } = initialized.parsed;
    const dataSpace = await resolveCommandDataSpace({ flagValue: flags['data-space'] });
    const apiVersion = flags['api-version'] ?? initialized.connection.version;
    const client = new MetadataClient(new SsotClient(initialized.connection, apiVersion, initialized.requestTiming));
    const entities = await client.list({
      dataSpace,
      entityType: flags['entity-type'],
      entityCategory: flags['entity-category'],
      limit: flags.limit,
      all: flags.all,
    });
    const rows = metadataListRows(entities);
    if (!this.jsonEnabled() && flags['result-format'] === 'human') {
      this.table({ data: rows, columns: ['name', 'displayName', 'entityCategory', 'entityType', 'fields#'] });
    } else if (!this.jsonEnabled() && flags['result-format'] === 'csv') {
      const columns = ['name', 'displayName', 'entityCategory', 'entityType', 'fields#'];
      process.stdout.write(
        `${[columns, ...rows.map((row) => columns.map((column) => row[column]))]
          .map((row) => row.map(csvCell).join(','))
          .join('\r\n')}\r\n`
      );
    } else if (!this.jsonEnabled()) {
      process.stdout.write(`${JSON.stringify(rows, undefined, 2)}\n`);
    }
    return { entities };
  }
}
