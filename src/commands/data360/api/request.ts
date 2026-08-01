import { loadCommandMessages } from '../../../messages.js';
import { Args, Flags } from '@oclif/core';
import type { Connection } from '@salesforce/core';
import { Data360Command } from '../../../command/Data360Command.js';
import {
  executeRawDirectRequest,
  executeRawRequest,
  responseHeaderBlock,
  writeResponseFile,
  type RawMethod,
} from '../../../api/rawRequest.js';
import { TokenCache } from '../../../client/tokenCache.js';
import { apiVersionFlag, noPromptFlag, noTokenCacheFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.api.request');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class ApiRequest extends Data360Command<void> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = false;
  public static readonly args = {
    endpoint: Args.string({ required: true, description: commandMessages.getMessage('flags.endpoint.description') }),
  };
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    method: Flags.option({
      char: 'X',
      options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const,
      default: 'GET' as const,
      summary: commandMessages.getMessage('flags.method.summary'),
    })(),
    header: Flags.string({ char: 'H', multiple: true, summary: commandMessages.getMessage('flags.header.summary') }),
    body: Flags.string({ char: 'b', summary: commandMessages.getMessage('flags.body.summary') }),
    include: Flags.boolean({ char: 'i', summary: commandMessages.getMessage('flags.include.summary') }),
    'stream-to-file': Flags.string({ char: 'S', summary: commandMessages.getMessage('flags.stream-to-file.summary') }),
    direct: Flags.boolean({ summary: commandMessages.getMessage('flags.direct.summary') }),
    'no-token-cache': noTokenCacheFlag,
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };

  public async run(): Promise<void> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(ApiRequest),
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => flags.timing,
    });
    const { args, flags } = initialized.parsed;
    if (flags.method !== 'GET') {
      await this.confirmDestructive(
        Boolean(flags['no-prompt']),
        commandMessages.getMessage('runtime.confirmMutation', [flags.method, args.endpoint])
      );
    }
    const response = flags.direct
      ? await this.directRequest(initialized.connection, flags, args.endpoint, initialized.requestTiming)
      : await executeRawRequest(initialized.connection, {
          apiVersion: flags['api-version'] ?? initialized.connection.version,
          endpoint: args.endpoint,
          method: flags.method as RawMethod,
          headers: flags.header ?? [],
          body: flags.body,
          timing: initialized.requestTiming,
        });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (flags.include) process.stdout.write(responseHeaderBlock(response));
    if (flags['stream-to-file']) await writeResponseFile(flags['stream-to-file'], bytes);
    else process.stdout.write(bytes);
    if (response.status >= 400) process.exitCode = 1;
  }

  private async directRequest(
    connection: Connection,
    flags: {
      'target-org': { getUsername: () => string | undefined };
      'no-token-cache': boolean;
      method: string;
      header?: string[];
      body?: string;
    },
    endpoint: string,
    timing: Parameters<typeof executeRawRequest>[1]['timing']
  ): Promise<Response> {
    const username = flags['target-org'].getUsername();
    if (!username) throw new Error(commandMessages.getMessage('error.RUNTIME_0.0'));
    const cache = await TokenCache.create({ bypass: flags['no-token-cache'] });
    try {
      return await executeRawDirectRequest(connection, cache, {
        username,
        endpoint,
        method: flags.method as RawMethod,
        headers: flags.header ?? [],
        body: flags.body,
        useCache: !flags['no-token-cache'],
        timing,
      });
    } finally {
      await cache.close();
    }
  }
}
