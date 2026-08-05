import { loadCommandMessages } from '../../messages.js';
import { resolveCommandDataSpace } from '../../configMeta.js';
import { Data360Command } from '../../command/Data360Command.js';
import { SsotClient } from '../../client/ssotClient.js';
import { DirectClient } from '../../client/directClient.js';
import { inspectProxyEnvironment } from '../../client/proxyFetch.js';
import { TokenCache } from '../../client/tokenCache.js';
import type { DirectToken } from '../../client/tokenExchange.js';
import { DOCTOR_STAGES, runDoctorChecks } from '../../doctor/checks.js';
import { createDoctorProgress } from '../../doctor/progress.js';
import type { DoctorResult } from '../../doctor/types.js';
import { apiVersionFlag, dataSpaceFlag, targetOrgFlag, timingFlag } from '../../shared/flags.js';

const commandMessages = loadCommandMessages('data360.doctor');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class Doctor extends Data360Command<DoctorResult> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    'data-space': dataSpaceFlag,
    timing: timingFlag,
  };

  public async run(): Promise<DoctorResult> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(Doctor),
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => flags.timing,
    });
    const { flags } = initialized.parsed;
    const apiVersion = flags['api-version'] ?? initialized.connection.version;
    const dataSpace = await resolveCommandDataSpace({ flagValue: flags['data-space'] });
    const client = new SsotClient(initialized.connection, apiVersion, initialized.requestTiming);
    const progress = createDoctorProgress({
      stages: [...DOCTOR_STAGES],
      jsonEnabled: this.jsonEnabled(),
      isTTY: Boolean(process.stderr.isTTY) && process.env.CI === undefined,
      log: (message) => this.status(message),
    });
    const username = flags['target-org'].getUsername();
    const cache = username ? await TokenCache.create({ bypass: true }) : undefined;
    let freshToken: DirectToken | undefined;
    const checks = await runDoctorChecks({
      identity: async () => initialized.connection.identity(),
      maxApiVersion: async () => initialized.connection.retrieveMaxApiVersion(),
      request: async <T>(endpoint: string) => client.get<T>(endpoint),
      exchange:
        username && cache
          ? async (): Promise<DirectToken> => {
              freshToken = await cache.get(username, initialized.connection);
              return freshToken;
            }
          : undefined,
      directRequest:
        username && cache
          ? async (): Promise<unknown> => {
              if (!freshToken) throw new Error(commandMessages.getMessage('error.RUNTIME_1.1'));
              return new DirectClient({
                username,
                connection: initialized.connection,
                cache,
                useCache: false,
                timing: initialized.requestTiming,
                token: freshToken,
              }).get('/api/v1/metadata');
            }
          : undefined,
      apiVersion,
      dataSpace,
      proxy: inspectProxyEnvironment(process.env),
    }).finally(async () => cache?.close());
    for (const check of checks) progress.report(check);
    progress.stop();
    if (!this.jsonEnabled()) this.table({ data: checks, columns: ['name', 'status', 'detail', 'action'] });
    if (checks.some(({ status }) => status === 'fail')) process.exitCode = 1;
    return { checks };
  }
}
