import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { DataGraphCommand } from '../../../dataGraph/command.js';
import { apiVersionFlag, outputFileFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';
import { writeFileAtomic } from '../../../shared/atomicFile.js';

const commandMessages = loadCommandMessages('data360.data-graph.query');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class DataGraphQuery extends DataGraphCommand<{
  item: Record<string, unknown>;
  outputFile?: string;
}> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    name: Flags.string({ char: 'n', required: true, summary: commandMessages.getMessage('flags.name.summary') }),
    id: Flags.string({ exactlyOne: ['id', 'lookup-keys'], summary: commandMessages.getMessage('flags.id.summary') }),
    'lookup-keys': Flags.string({
      exactlyOne: ['id', 'lookup-keys'],
      summary: commandMessages.getMessage('flags.lookup-keys.summary'),
    }),
    live: Flags.boolean({ summary: commandMessages.getMessage('flags.live.summary') }),
    'output-file': outputFileFlag,
    timing: timingFlag,
  };

  public async run(): Promise<{ item: Record<string, unknown>; outputFile?: string }> {
    const { flags, client } = await this.initializeDataGraph(DataGraphQuery);
    const entity = await this.resolveEntity(client, flags.name as string);
    const id = flags.id as string | undefined;
    const item = await client.request<Record<string, unknown>>({
      method: 'GET',
      endpoint: `/data-graphs/data/${encodeURIComponent(entity)}${id ? `/${encodeURIComponent(id)}` : ''}`,
      query: {
        lookupKeys: flags['lookup-keys'] as string | undefined,
        live: flags.live ? true : undefined,
      },
    });
    const outputFile = flags['output-file'] as string | undefined;
    if (outputFile) await writeFileAtomic(outputFile, `${JSON.stringify(item, undefined, 2)}\n`);
    else if (!this.jsonEnabled()) process.stdout.write(`${JSON.stringify(item, undefined, 2)}\n`);
    return { item, outputFile };
  }
}
