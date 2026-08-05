import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { resolveCommandDataSpace } from '../../../configMeta.js';
import { Data360Command } from '../../../command/Data360Command.js';
import { SsotClient } from '../../../client/ssotClient.js';
import { MetadataClient } from '../../../metadata/client.js';
import { metadataFieldRows, metadataRelationshipRows } from '../../../metadata/output.js';
import type { EntityMetadata } from '../../../metadata/types.js';
import { apiVersionFlag, dataSpaceFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.metadata.get');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class MetadataGet extends Data360Command<EntityMetadata> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    'data-space': dataSpaceFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    timing: timingFlag,
  };

  public async run(): Promise<EntityMetadata> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(MetadataGet),
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => flags.timing,
    });
    const { flags } = initialized.parsed;
    const dataSpace = await resolveCommandDataSpace({ flagValue: flags['data-space'] });
    const apiVersion = flags['api-version'] ?? initialized.connection.version;
    const entity = await new MetadataClient(
      new SsotClient(initialized.connection, apiVersion, initialized.requestTiming)
    ).get(flags.name, dataSpace);
    if (!this.jsonEnabled()) {
      this.status(
        commandMessages.getMessage('runtime.status.0', [String(entity.displayName ?? entity.name), String(entity.name)])
      );
      this.table({
        data: metadataFieldRows(entity),
        columns: ['name', 'type', 'businessType', 'primaryKey?'],
      });
      this.table({
        data: metadataRelationshipRows(entity),
        columns: ['name', 'relatedEntity', 'cardinality'],
      });
    }
    return entity;
  }
}
