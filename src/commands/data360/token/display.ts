import { loadCommandMessages } from '../../../messages.js';
import { Data360Command } from '../../../command/Data360Command.js';
import { TokenCache } from '../../../client/tokenCache.js';
import { apiVersionFlag, noTokenCacheFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.token.display');

export type TokenDisplayResult = {
  accessToken: string;
  instanceUrl: string;
  expiresAt: string;
  scopes: string[];
};

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class TokenDisplay extends Data360Command<TokenDisplayResult> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    'no-token-cache': noTokenCacheFlag,
    timing: timingFlag,
  };

  public async run(): Promise<TokenDisplayResult> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(TokenDisplay),
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => flags.timing,
    });
    const { flags } = initialized.parsed;
    const username = flags['target-org'].getUsername();
    if (!username) throw new Error(commandMessages.getMessage('error.RUNTIME_0.0'));
    const cache = await TokenCache.create({ bypass: flags['no-token-cache'] });
    try {
      const token = await cache.get(username, initialized.connection, { useCache: !flags['no-token-cache'] });
      if (!this.jsonEnabled()) {
        this.log(commandMessages.getMessage('runtime.instance-url', [token.instanceUrl]));
        this.log(commandMessages.getMessage('runtime.expires-at', [token.expiresAt]));
        this.table({ data: (token.scopes ?? []).map((scope) => ({ scope })), columns: ['scope'] });
        this.status(commandMessages.getMessage('runtime.status.1'));
        this.logSensitive(token.jwt);
      }
      return {
        accessToken: token.jwt,
        instanceUrl: token.instanceUrl,
        expiresAt: token.expiresAt,
        scopes: token.scopes ?? [],
      };
    } finally {
      await cache.close();
    }
  }
}
