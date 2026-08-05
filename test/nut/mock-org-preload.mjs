import process from 'node:process';
import { URL } from 'node:url';
import { Org } from '@salesforce/core';
import { fetch } from 'undici';
import { TokenCache } from '../../lib/client/tokenCache.js';
import { exchangeConnection } from '../../lib/client/tokenExchange.js';

const baseUrl = process.env.D360_NUT_MOCK_URL;
if (baseUrl) {
  const username = 'subprocess-nut@example.invalid';
  Org.create = async ({ aliasOrUsername } = {}) => {
    const resolvedUsername = aliasOrUsername ?? username;
    const connection = {
      version: '67.0',
      instanceUrl: baseUrl,
      accessToken: 'synthetic-core-token',
      refreshAuth: async () => undefined,
      identity: async () => ({ username: resolvedUsername }),
      retrieveMaxApiVersion: async () => '67.0',
      request: async ({ body, headers, method = 'GET', url }) => {
        const response = await fetch(new URL(url, baseUrl), {
          method,
          headers,
          ...(body === undefined ? {} : { body }),
        });
        const contentType = response.headers.get('content-type') ?? '';
        const payload =
          response.status === 204
            ? undefined
            : contentType.includes('json')
              ? await response.json()
              : await response.text();
        if (!response.ok) {
          throw Object.assign(new Error(`Mock Salesforce request failed with status ${response.status}.`), {
            statusCode: response.status,
            body: payload,
            headers: Object.fromEntries(response.headers),
          });
        }
        return payload;
      },
    };
    return {
      getUsername: () => resolvedUsername,
      getConnection: (apiVersion) => ({ ...connection, version: apiVersion ?? connection.version }),
    };
  };
  TokenCache.create = async () => {
    let cached;
    return {
      get: async (_username, connection, options = {}) => {
        if (!cached || options.useCache === false) cached = await exchangeConnection(connection, { env: process.env });
        return cached;
      },
      invalidate: async () => {
        cached = undefined;
      },
      close: async () => undefined,
    };
  };
}
