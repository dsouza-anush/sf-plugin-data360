import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { ConnectionCommand } from '../../../connection/command.js';
import { apiVersionFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.connection.describe');

const sections = ['databases', 'schemas', 'objects', 'fields', 'preview', 'endpoints', 'sitemap'] as const;

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class ConnectionDescribe extends ConnectionCommand<{ sections: Record<string, unknown> }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    databases: Flags.boolean({ summary: commandMessages.getMessage('flags.databases.summary') }),
    schemas: Flags.boolean({ summary: commandMessages.getMessage('flags.schemas.summary') }),
    objects: Flags.boolean({ summary: commandMessages.getMessage('flags.objects.summary') }),
    fields: Flags.boolean({ dependsOn: ['object'], summary: commandMessages.getMessage('flags.fields.summary') }),
    preview: Flags.boolean({ dependsOn: ['object'], summary: commandMessages.getMessage('flags.preview.summary') }),
    endpoints: Flags.boolean({ summary: commandMessages.getMessage('flags.endpoints.summary') }),
    sitemap: Flags.boolean({ summary: commandMessages.getMessage('flags.sitemap.summary') }),
    object: Flags.string({ summary: commandMessages.getMessage('flags.object.summary') }),
    timing: timingFlag,
  };

  public async run(): Promise<{ sections: Record<string, unknown> }> {
    const { flags, client } = await this.initializeConnection(ConnectionDescribe);
    const selected = sections.filter((section) => Boolean(flags[section]));
    if (selected.length === 0) {
      throw new SfError(commandMessages.getMessage('error.D360_INVALID_DEFINITION.0'), 'D360_INVALID_DEFINITION', [
        commandMessages.getMessage('error.D360_INVALID_DEFINITION.0.actions.1'),
      ]);
    }
    const result: Record<string, unknown> = {};
    for (const section of selected) {
      result[section] = await client.describe(flags.name as string, section, flags.object as string | undefined);
      if (!this.jsonEnabled()) {
        const rows = Array.isArray(result[section]) ? result[section] : [result[section]];
        this.table({ data: rows as Array<Record<string, unknown>>, columns: Object.keys(rows[0] ?? {}) });
      }
    }
    return { sections: result };
  }
}
