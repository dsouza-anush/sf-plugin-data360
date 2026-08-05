import { loadCommandMessages } from '../../../messages.js';
import { Data360Command } from '../../../command/Data360Command.js';
import { apiVersionFlag, noPromptFlag, targetOrgFlag, timingFlag } from '../../../shared/flags.js';
import { createProxyAwareFetch } from '../../../client/proxyFetch.js';
import { Flags as OclifFlags } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { performance } from 'node:perf_hooks';
import { format } from 'node:util';
import { terminalSafeText } from '../../../ux/terminal.js';

const commandMessages = loadCommandMessages('data360.setup.eca');
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const VALID_DEV_NAME = /^[A-Za-z]\w{0,29}$/u;

const DEFAULT_APP_NAME = 'D360CLI';

const OAUTH_SCOPES = [
  { cli: 'api', metadata: 'Api' },
  { cli: 'web', metadata: 'Web' },
  { cli: 'refresh_token', metadata: 'RefreshToken' },
  { cli: 'cdp_api', metadata: 'CDP' },
  { cli: 'cdp_query_api', metadata: 'CDPQuery' },
  { cli: 'cdp_profile_api', metadata: 'CDPProfile' },
  { cli: 'cdp_ingest_api', metadata: 'CDPIngest' },
] as const;

const CDP_OAUTH_SCOPES = OAUTH_SCOPES.map(({ metadata }) => metadata).join(', ');

const CALLBACK_URLS = ['http://localhost:1717/OauthRedirect', 'http://localhost:55556/Callback'].join('\n');

export type EcaSetupResult = {
  appName: string;
  consumerKey: string | null;
  instanceUrl: string;
  scopes: string[];
  created: boolean;
  reauthorizeCommand: string;
};

type MetadataResponse = {
  success: boolean;
  fullName?: string;
  errors?: { message: string; statusCode?: string }[];
};

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class SetupEca extends Data360Command<EcaSetupResult> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    'app-name': OclifFlags.string({
      char: 'n',
      default: DEFAULT_APP_NAME,
      summary: commandMessages.getMessage('flags.app-name.summary'),
    }),
    'contact-email': OclifFlags.string({
      char: 'e',
      summary: commandMessages.getMessage('flags.contact-email.summary'),
    }),
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };

  public async run(): Promise<EcaSetupResult> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(SetupEca),
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => flags.timing,
    });

    const { flags } = initialized.parsed;
    const connection = initialized.connection;
    const appName = flags['app-name'];
    const contactEmail = flags['contact-email'] ?? flags['target-org'].getUsername();
    const instanceUrl = connection.instanceUrl;

    if (!VALID_DEV_NAME.test(appName)) {
      throw new SfError(
        format(commandMessages.getMessage('error.D360_ECA_INVALID_NAME'), appName),
        'D360_ECA_INVALID_NAME',
        [commandMessages.getMessage('error.D360_ECA_INVALID_NAME.actions')]
      );
    }

    if (!contactEmail) {
      throw new SfError(commandMessages.getMessage('error.D360_ECA_CONTACT_REQUIRED'), 'D360_ECA_CREATE_FAILED', [
        commandMessages.getMessage('error.D360_ECA_CONTACT_REQUIRED.actions'),
      ]);
    }

    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      format(commandMessages.getMessage('info.ECA_CREATING'), appName)
    );

    const metadataUrl = `${instanceUrl}/services/Soap/m/${connection.version}`;
    const transport = createProxyAwareFetch();
    const requestStart = performance.now();
    try {
      await connection.refreshAuth();
      const accessToken = connection.accessToken;
      if (!accessToken) {
        throw new SfError(commandMessages.getMessage('error.D360_ECA_CREATE_FAILED'), 'D360_ECA_CREATE_FAILED', [
          commandMessages.getMessage('error.D360_ECA_CREATE_FAILED.actions'),
        ]);
      }

      // Step 1: Create ExternalClientApplication
      this.status(commandMessages.getMessage('info.ECA_STEP_APP'));
      const appResult = await this.createMetadata(transport, metadataUrl, accessToken, {
        type: 'ExternalClientApplication',
        fullName: appName,
        fields: { label: appName, contactEmail, distributionState: 'LOCAL' },
      });

      let created = true;
      if (!appResult.success) {
        const isDuplicate = appResult.errors?.some(
          (e) => e.statusCode === 'DUPLICATE_VALUE' || e.message?.toLowerCase().includes('duplicate')
        );
        if (isDuplicate) {
          this.status(format(commandMessages.getMessage('info.ECA_DUPLICATE'), appName));
          created = false;
        } else {
          throw new SfError(
            commandMessages.getMessage('error.D360_ECA_CREATE_FAILED'),
            'D360_ECA_CREATE_FAILED',
            [commandMessages.getMessage('error.D360_ECA_CREATE_FAILED.actions')],
            1,
            new Error(JSON.stringify(appResult.errors))
          );
        }
      }

      // Step 2: Create ExtlClntAppOauthSettings with CDP scopes
      this.status(commandMessages.getMessage('info.ECA_STEP_OAUTH'));
      const oauthResult = await this.createMetadata(transport, metadataUrl, accessToken, {
        type: 'ExtlClntAppOauthSettings',
        fullName: `${appName}_oauth`,
        fields: {
          label: `${appName}_oauth`,
          externalClientApplication: appName,
          commaSeparatedOauthScopes: CDP_OAUTH_SCOPES,
          isFirstPartyAppEnabled: 'false',
        },
      });

      if (!oauthResult.success) {
        const isDuplicate = oauthResult.errors?.some(
          (e) => e.statusCode === 'DUPLICATE_VALUE' || e.message?.toLowerCase().includes('duplicate')
        );
        if (!isDuplicate) {
          throw new SfError(
            commandMessages.getMessage('error.D360_ECA_OAUTH_FAILED'),
            'D360_ECA_OAUTH_FAILED',
            [commandMessages.getMessage('error.D360_ECA_OAUTH_FAILED.actions')],
            1,
            new Error(JSON.stringify(oauthResult.errors))
          );
        }
      }

      // Step 3: Create ExtlClntAppGlobalOauthSettings (flows + callbacks)
      this.status(commandMessages.getMessage('info.ECA_STEP_GLOBAL'));
      const globalResult = await this.createMetadata(transport, metadataUrl, accessToken, {
        type: 'ExtlClntAppGlobalOauthSettings',
        fullName: `${appName}_glbloauth`,
        fields: {
          label: `${appName}_glbloauth`,
          externalClientApplication: appName,
          callbackUrl: CALLBACK_URLS,
          isClientCredentialsFlowEnabled: 'false',
          isCodeCredFlowEnabled: 'true',
          isCodeCredPostOnly: 'false',
          isConsumerSecretOptional: 'true',
          isDeviceFlowEnabled: 'false',
          isIntrospectAllTokens: 'false',
          isNamedUserJwtEnabled: 'false',
          isPkceRequired: 'true',
          isRefreshTokenRotationEnabled: 'false',
          isSecretRequiredForRefreshToken: 'false',
          isSecretRequiredForTokenExchange: 'false',
          isTokenExchangeEnabled: 'false',
          shouldRotateConsumerKey: 'false',
          shouldRotateConsumerSecret: 'false',
        },
      });

      if (!globalResult.success) {
        const isDuplicate = globalResult.errors?.some(
          (e) => e.statusCode === 'DUPLICATE_VALUE' || e.message?.toLowerCase().includes('duplicate')
        );
        if (!isDuplicate) {
          // Global settings may be auto-generated in some orgs — warn rather than fail.
          this.warn(
            terminalSafeText(
              format(commandMessages.getMessage('info.ECA_GLOBAL_WARN'), JSON.stringify(globalResult.errors))
            )
          );
        }
      }

      // Step 4: Retrieve consumer key via readMetadata
      this.status(commandMessages.getMessage('info.ECA_STEP_RETRIEVE'));
      const consumerKey = await this.retrieveConsumerKey(transport, metadataUrl, accessToken, appName);
      if (consumerKey && !/^[A-Za-z\d._~-]+$/u.test(consumerKey)) {
        throw new SfError(commandMessages.getMessage('error.D360_ECA_RETRIEVE_FAILED'), 'D360_ECA_CREATE_FAILED', [
          commandMessages.getMessage('error.D360_ECA_RETRIEVE_FAILED.actions'),
        ]);
      }

      const orgAlias = flags['target-org'].getUsername() ?? 'my-org';
      const scopes = OAUTH_SCOPES.map(({ cli }) => cli);
      const reauthorizeCommand = [
        'sf org login web',
        `--instance-url ${shellQuote(instanceUrl)}`,
        `--client-id ${shellQuote(consumerKey ?? '<consumer-key>')}`,
        `--alias ${shellQuote(orgAlias)}`,
        `--scopes ${shellQuote(scopes.join(' '))}`,
      ].join(' \\\n    ');

      if (!this.jsonEnabled()) {
        this.log();
        this.styledHeader(format(commandMessages.getMessage('info.ECA_CREATED'), appName));
        this.log();
        this.table({
          data: [
            { field: 'App Name', value: appName },
            { field: 'Consumer Key', value: consumerKey ?? '(retrieve from Setup UI)' },
            { field: 'Instance URL', value: instanceUrl },
            { field: 'CDP Scopes', value: scopes.filter((s) => s.startsWith('cdp_')).join(', ') },
            { field: 'Status', value: created ? 'Created' : 'Already existed' },
          ],
          columns: ['field', 'value'],
        });
        this.log();
        this.log(
          format(
            commandMessages.getMessage('info.ECA_REAUTH_INSTRUCTIONS'),
            shellQuote(instanceUrl),
            shellQuote(consumerKey ?? '<consumer-key>'),
            shellQuote(orgAlias),
            shellQuote(scopes.join(' ')),
            shellQuote(orgAlias)
          )
        );
        this.log();
        this.log(commandMessages.getMessage('info.ECA_ACTIVATION_NOTE'));
      }

      return { appName, consumerKey, instanceUrl, scopes, created, reauthorizeCommand };
    } finally {
      await transport.close().catch(() => undefined);
      const requestMs = Math.round(performance.now() - requestStart);
      initialized.requestTiming.onTiming?.({
        parseMs: initialized.requestTiming.parseMs,
        connectionMs: initialized.requestTiming.connectionMs,
        requestMs,
        totalMs: initialized.requestTiming.parseMs + initialized.requestTiming.connectionMs + requestMs,
      });
    }
  }

  private async createMetadata(
    transport: ReturnType<typeof createProxyAwareFetch>,
    metadataUrl: string,
    sessionId: string,
    config: { type: string; fullName: string; fields: Record<string, string> }
  ): Promise<MetadataResponse> {
    const fieldXml = Object.entries(config.fields)
      .map(([key, value]) => `<met:${key}>${this.escapeXml(value)}</met:${key}>`)
      .join('');

    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header><met:SessionHeader><met:sessionId>${sessionId}</met:sessionId></met:SessionHeader></soapenv:Header>
  <soapenv:Body><met:createMetadata><met:metadata xsi:type="met:${config.type}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><met:fullName>${this.escapeXml(config.fullName)}</met:fullName>${fieldXml}</met:metadata></met:createMetadata></soapenv:Body>
</soapenv:Envelope>`;

    const oauthSettings = config.type !== 'ExternalClientApplication';
    const text = await this.metadataRequest(transport, metadataUrl, 'createMetadata', envelope, {
      code: oauthSettings ? 'D360_ECA_OAUTH_FAILED' : 'D360_ECA_CREATE_FAILED',
      message: oauthSettings ? 'error.D360_ECA_OAUTH_FAILED' : 'error.D360_ECA_CREATE_FAILED',
      action: oauthSettings ? 'error.D360_ECA_OAUTH_FAILED.actions' : 'error.D360_ECA_CREATE_FAILED.actions',
    });
    const success = text.includes('<success>true</success>');
    const errors = this.extractErrors(text);

    return { success, fullName: config.fullName, errors: success ? undefined : errors };
  }

  private async retrieveConsumerKey(
    transport: ReturnType<typeof createProxyAwareFetch>,
    metadataUrl: string,
    sessionId: string,
    appName: string
  ): Promise<string | null> {
    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header><met:SessionHeader><met:sessionId>${sessionId}</met:sessionId></met:SessionHeader></soapenv:Header>
  <soapenv:Body><met:readMetadata><met:type>ExtlClntAppGlobalOauthSettings</met:type><met:fullNames>${appName}_glbloauth</met:fullNames></met:readMetadata></soapenv:Body>
</soapenv:Envelope>`;

    const text = await this.metadataRequest(transport, metadataUrl, 'readMetadata', envelope, {
      code: 'D360_ECA_CREATE_FAILED',
      message: 'error.D360_ECA_RETRIEVE_FAILED',
      action: 'error.D360_ECA_RETRIEVE_FAILED.actions',
    });
    const keyMatch = /<consumerKey>([^<]+)<\/consumerKey>/u.exec(text);
    return keyMatch?.[1] ?? null;
  }

  private async metadataRequest(
    transport: ReturnType<typeof createProxyAwareFetch>,
    metadataUrl: string,
    soapAction: string,
    body: string,
    error: { code: string; message: string; action: string }
  ): Promise<string> {
    let response: Response;
    try {
      response = await transport.fetch(metadataUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml', SOAPAction: soapAction },
        body,
      });
    } catch {
      throw new SfError(commandMessages.getMessage(error.message), error.code, [
        commandMessages.getMessage(error.action),
      ]);
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new SfError(commandMessages.getMessage(error.message), error.code, [
        commandMessages.getMessage(error.action),
      ]);
    }
    const fault = this.extractErrors(text).find(({ statusCode }) => statusCode === 'SOAP_FAULT');
    if (!response.ok || fault) {
      throw new SfError(
        commandMessages.getMessage(error.message),
        error.code,
        [commandMessages.getMessage(error.action)],
        1,
        new Error(fault?.message ?? `Metadata API returned HTTP ${response.status}.`)
      );
    }
    return text;
  }

  private extractErrors(xml: string): { message: string; statusCode?: string }[] {
    const errors: { message: string; statusCode?: string }[] = [];
    const blocks = [...xml.matchAll(/<(?:\w+:)?errors>([\s\S]*?)<\/(?:\w+:)?errors>/gu)].map((match) => match[1]);
    for (const block of blocks) {
      const message = /<(?:\w+:)?message>([^<]*)<\/(?:\w+:)?message>/u.exec(block)?.[1];
      const statusCode = /<(?:\w+:)?statusCode>([^<]*)<\/(?:\w+:)?statusCode>/u.exec(block)?.[1];
      if (message) errors.push({ message, statusCode });
    }
    for (const match of xml.matchAll(/<(?:\w+:)?faultstring>([^<]*)<\/(?:\w+:)?faultstring>/gu)) {
      errors.push({ message: match[1], statusCode: 'SOAP_FAULT' });
    }
    return errors;
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;')
      .replace(/"/gu, '&quot;')
      .replace(/'/gu, '&apos;');
  }
}
