import { loadCommandMessages } from '../messages.js';
import { SfError } from '@salesforce/core';

const runtimeMessages = loadCommandMessages('data360.runtime.client.testTenantUrl');

const isLoopback = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';

/**
 * Returns the Direct API test override only in tests and only for a loopback URL.
 * Production code must use the tenant URL returned by the a360 token exchange.
 */
export const resolveTestTenantUrl = (
  env: Readonly<Record<string, string | undefined>> = process.env
): URL | undefined => {
  const value = env.SF_DATA360_TENANT_URL;
  if (!value) return undefined;
  if (env.NODE_ENV !== 'test') {
    throw new SfError(runtimeMessages.getMessage('error.D360_API_ERROR.0'), 'D360_API_ERROR', [
      runtimeMessages.getMessage('error.D360_API_ERROR.0.actions.1'),
    ]);
  }
  const url = new URL(value);
  if (!isLoopback(url.hostname)) {
    throw new SfError(runtimeMessages.getMessage('error.D360_API_ERROR.1'), 'D360_API_ERROR', [
      runtimeMessages.getMessage('error.D360_API_ERROR.1.actions.1'),
    ]);
  }
  return url;
};
