import type { DoctorCheck, DataSpace } from './types.js';
import type { ProxyDiagnostics } from '../client/proxyFetch.js';

export const DOCTOR_STAGES = [
  'Org authentication',
  'API version alignment',
  'Data 360 provisioning',
  'Data spaces',
  'Direct API token exchange',
  'Direct API ping',
  'Direct API scopes',
  'Configured data space',
] as const;

type DoctorDependencies = {
  identity: () => Promise<{ username?: string; user_id?: string }>;
  maxApiVersion: () => Promise<string>;
  request: <T>(endpoint: string) => Promise<T>;
  apiVersion: string;
  dataSpace: string;
  exchange?: () => Promise<{ jwt: string; instanceUrl: string; expiresAt: string; scopes?: string[] }>;
  directRequest?: () => Promise<unknown>;
  proxy?: ProxyDiagnostics;
};

const failure = (name: string, error: unknown, action: string): DoctorCheck => ({
  name,
  status: 'fail',
  detail: error instanceof Error ? error.message : String(error),
  action,
});

export const runDoctorChecks = async (dependencies: DoctorDependencies): Promise<DoctorCheck[]> => {
  const checks: DoctorCheck[] = [];
  try {
    const identity = await dependencies.identity();
    checks.push({
      name: 'Org authentication',
      status: 'pass',
      detail: identity.username ?? identity.user_id ?? 'Authenticated',
    });
  } catch (error) {
    checks.push(failure('Org authentication', error, 'Run sf org login web -o <alias>.'));
  }

  try {
    const maximum = await dependencies.maxApiVersion();
    const aligned = Number(dependencies.apiVersion) <= Number(maximum);
    checks.push({
      name: 'API version alignment',
      status: aligned ? 'pass' : 'fail',
      detail: `Requested v${dependencies.apiVersion}; org supports v${maximum}.`,
      action: aligned ? undefined : `Use --api-version ${maximum}.`,
    });
  } catch (error) {
    checks.push(failure('API version alignment', error, 'Retry without --api-version.'));
  }

  let metadataProbeError: unknown;
  try {
    await dependencies.request('/metadata');
    checks.push({ name: 'Data 360 provisioning', status: 'pass', detail: 'Metadata endpoint is available.' });
  } catch (error) {
    metadataProbeError = error;
    checks.push(failure('Data 360 provisioning', error, 'Confirm Data 360 is provisioned in this org.'));
  }

  let spaces: DataSpace[] = [];
  let spacesAvailable = false;
  try {
    const response = await dependencies.request<{ dataSpaces?: DataSpace[] }>('/data-spaces');
    spaces = response.dataSpaces ?? [];
    spacesAvailable = true;
    if (metadataProbeError) {
      checks[2] = {
        name: 'Data 360 provisioning',
        status: 'pass',
        detail: 'Data-spaces fallback probe is available; metadata is unavailable at this API version.',
      };
    }
    checks.push({ name: 'Data spaces', status: 'pass', detail: `${spaces.length} data space(s) available.` });
  } catch (error) {
    checks.push(failure('Data spaces', error, 'Confirm the Data 360 data-spaces API is accessible.'));
  }

  if (!dependencies.exchange || !dependencies.directRequest) {
    checks.push(
      {
        name: 'Direct API token exchange',
        status: 'fail',
        detail: 'Direct checks were not configured; core-org SSOT commands remain available.',
        action: 'Configure the External Client App before using Direct API commands.',
      },
      {
        name: 'Direct API ping',
        status: 'fail',
        detail: 'Skipped because Direct API dependencies were not configured.',
        action: 'Use core-org SSOT commands or configure Direct API access.',
      },
      {
        name: 'Direct API scopes',
        status: 'fail',
        detail: 'Skipped because no exchange response was available.',
        action: 'Configure cdp_api, cdp_query_api, cdp_profile_api, and cdp_ingest_api.',
      }
    );
  } else {
    try {
      const token = await dependencies.exchange();
      checks.push({
        name: 'Direct API token exchange',
        status: 'pass',
        detail: `Token exchange succeeded; token expires at ${token.expiresAt}.`,
      });
      try {
        await dependencies.directRequest();
        const proxyDetail = dependencies.proxy?.enabled
          ? ` Enterprise proxy routing is configured${dependencies.proxy.noProxyConfigured ? ' with NO_PROXY bypass rules' : ''}.`
          : '';
        checks.push({
          name: 'Direct API ping',
          status: 'pass',
          detail: `Direct metadata endpoint is available.${proxyDetail}`,
        });
      } catch (error) {
        checks.push({
          name: 'Direct API ping',
          status: 'fail',
          detail: error instanceof Error ? error.message : String(error),
          action: 'Confirm the tenant URL and cdp_api scope, then run doctor again.',
        });
      }
      const required = ['cdp_api', 'cdp_query_api', 'cdp_profile_api', 'cdp_ingest_api'];
      if (token.scopes === undefined) {
        checks.push({
          name: 'Direct API scopes',
          status: 'warn',
          detail:
            'Token exchange did not report a scope inventory; the successful Direct metadata ping verifies cdp_api only.',
          action: 'Verify cdp_query_api, cdp_profile_api, and cdp_ingest_api before using those Direct APIs.',
        });
      } else {
        const missing = required.filter((scope) => !token.scopes?.includes(scope));
        checks.push({
          name: 'Direct API scopes',
          status: missing.length === 0 ? 'pass' : 'fail',
          detail:
            missing.length === 0
              ? `Configured scopes: ${required.join(', ')}.`
              : `Missing scopes: ${missing.join(', ')}.`,
          action:
            missing.length === 0
              ? undefined
              : 'Add the missing scopes to the External Client App and authorize the org again.',
        });
      }
    } catch (error) {
      checks.push(
        {
          name: 'Direct API token exchange',
          status: 'fail',
          detail: error instanceof Error ? error.message : String(error),
          action: 'Check the External Client App and its cdp_* scopes.',
        },
        {
          name: 'Direct API ping',
          status: 'fail',
          detail: 'Skipped because token exchange failed.',
          action: 'Resolve the token exchange warning first.',
        },
        {
          name: 'Direct API scopes',
          status: 'fail',
          detail: 'Could not inspect scopes because token exchange failed.',
          action: 'Configure cdp_api, cdp_query_api, cdp_profile_api, and cdp_ingest_api.',
        }
      );
    }
  }
  const configured = spaces.some(({ name }) => name === dependencies.dataSpace);
  checks.push({
    name: 'Configured data space',
    status: spacesAvailable ? (configured ? 'pass' : 'fail') : 'warn',
    detail: !spacesAvailable
      ? `Could not verify "${dependencies.dataSpace}" because the data-spaces check failed.`
      : configured
        ? `"${dependencies.dataSpace}" exists.`
        : `"${dependencies.dataSpace}" was not found among the available data spaces.`,
    action: !spacesAvailable
      ? 'Resolve the data-spaces API failure, then run doctor again.'
      : configured
        ? undefined
        : 'Set data360-data-space to an existing data space.',
  });
  return checks;
};
