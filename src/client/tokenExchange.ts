import { loadCommandMessages } from '../messages.js';
import { SfError, type Connection, type Org } from '@salesforce/core';
import { createProxyAwareFetch } from './proxyFetch.js';
import { resolveTestTenantUrl } from './testTenantUrl.js';
import { redactSecretString } from '../shared/redact.js';
import { performance } from 'node:perf_hooks';
import {
  appendTraceEvent,
  redactTraceString,
  traceCommandReference,
  traceEnabled,
  traceHeaderMetadata,
  traceHeaders,
  tracePayload,
} from './trace.js';

const runtimeMessages = loadCommandMessages('data360.runtime.client.tokenExchange');

export const A360_GRANT_TYPE = 'urn:salesforce:grant-type:external:cdp';
export const SUBJECT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const BARE_HOSTNAME = /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/iu;

export type DirectToken = {
  jwt: string;
  instanceUrl: string;
  expiresAt: string;
  scopes?: string[];
};

export type TokenExchangeOptions = {
  now?: () => number;
  fetch?: typeof fetch;
  env?: Readonly<Record<string, string | undefined>>;
};

type ExchangeResponse = {
  access_token?: string;
  instance_url?: string;
  expires_in?: number;
  scope?: string;
  scopes?: string[] | string;
  error?: string;
  error_description?: string;
};

type TokenExchangeErrorData = {
  httpStatus: number;
};

export const validateTenantUrl = (
  value: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): string => {
  let url: URL;
  try {
    url = new URL(BARE_HOSTNAME.test(value) ? `https://${value}` : value);
  } catch {
    throw new SfError(runtimeMessages.getMessage('error.D360_TOKEN_EXCHANGE_FAILED.0'), 'D360_TOKEN_EXCHANGE_FAILED', [
      runtimeMessages.getMessage('error.D360_TOKEN_EXCHANGE_FAILED.0.actions.1'),
    ]);
  }
  const override = resolveTestTenantUrl(env);
  if (override && url.origin === override.origin && url.pathname === '/' && !url.search && !url.hash) {
    return url.origin;
  }
  const hostname = url.hostname.toLowerCase();
  const approved = hostname === 'c360a.salesforce.com' || hostname.endsWith('.c360a.salesforce.com');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !approved ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new SfError(runtimeMessages.getMessage('error.D360_TOKEN_EXCHANGE_FAILED.1'), 'D360_TOKEN_EXCHANGE_FAILED', [
      runtimeMessages.getMessage('error.D360_TOKEN_EXCHANGE_FAILED.1.actions.1'),
    ]);
  }
  return url.origin;
};

export const exchangeConnection = async (
  connection: Connection,
  options: TokenExchangeOptions = {}
): Promise<DirectToken> => {
  await connection.refreshAuth();
  const subjectToken = connection.accessToken;
  if (!subjectToken) {
    throw new SfError(runtimeMessages.getMessage('error.D360_AUTH_EXPIRED.2'), 'D360_AUTH_EXPIRED', [
      runtimeMessages.getMessage('error.D360_AUTH_EXPIRED.2.actions.1'),
    ]);
  }
  const transport = createProxyAwareFetch({ fetch: options.fetch, env: options.env });
  try {
    const url = new URL('/services/a360/token', connection.instanceUrl);
    const body = new URLSearchParams({
      grant_type: A360_GRANT_TYPE,
      subject_token: subjectToken,
      subject_token_type: SUBJECT_TOKEN_TYPE,
    });
    const headers = traceHeaders({ 'content-type': 'application/x-www-form-urlencoded' }, options.env);
    const tracing = traceEnabled(options.env);
    const commandReference = tracing ? traceCommandReference(options.env) : undefined;
    const requestPayload = tracing ? tracePayload(body.toString()) : undefined;
    const startedAt = performance.now();
    const requestSequence = tracing
      ? await appendTraceEvent(
          {
            type: 'http.request',
            seqRef: commandReference ?? 0,
            method: 'POST',
            url: redactTraceString(url.toString()),
            root: 'core',
            headers: traceHeaderMetadata(headers),
            bodyDigest: requestPayload!.digest,
            bodyBytes: requestPayload!.bytes,
            retryAttempt: 0,
          },
          options.env
        )
      : undefined;
    let response: Response;
    try {
      response = await transport.fetch(url, { method: 'POST', headers, body });
    } catch (error) {
      if (requestSequence !== undefined) {
        const payload = tracePayload(error);
        await appendTraceEvent(
          {
            type: 'http.response',
            seqRef: commandReference ?? 0,
            requestRef: requestSequence,
            root: 'core',
            status: 0,
            statusInferred: true,
            durationMs: Math.max(0, performance.now() - startedAt),
            retryAttempt: 0,
            headers: {},
            bodyDigest: payload.digest,
            bodyBytes: payload.bytes,
          },
          options.env
        );
      }
      throw error;
    }
    let payload: ExchangeResponse;
    let responseText = '';
    try {
      responseText = await response.text();
      payload = JSON.parse(responseText) as ExchangeResponse;
    } catch {
      payload = {};
    }
    if (requestSequence !== undefined) {
      const responsePayload = tracePayload(responseText || payload);
      await appendTraceEvent(
        {
          type: 'http.response',
          seqRef: commandReference ?? 0,
          requestRef: requestSequence,
          root: 'core',
          status: response.status,
          statusInferred: false,
          durationMs: Math.max(0, performance.now() - startedAt),
          retryAttempt: 0,
          headers: traceHeaderMetadata(response.headers),
          bodyDigest: responsePayload.digest,
          bodyBytes: responsePayload.bytes,
        },
        options.env
      );
    }
    if (response.ok && !payload.access_token) {
      const error = new SfError(
        runtimeMessages.getMessage('error.D360_TOKEN_EXCHANGE_FAILED.4'),
        'D360_TOKEN_EXCHANGE_FAILED',
        [
          runtimeMessages.getMessage('error.D360_TOKEN_EXCHANGE_FAILED.4.actions.1'),
          runtimeMessages.getMessage('error.D360_TOKEN_EXCHANGE_FAILED.4.actions.2'),
        ],
        1
      ) as SfError<TokenExchangeErrorData>;
      error.data = { httpStatus: response.status };
      throw error;
    }
    if (!response.ok || !payload.access_token || !payload.instance_url || !Number.isFinite(payload.expires_in)) {
      const error = new SfError(
        redactSecretString(
          payload.error_description ?? payload.error ?? `Data 360 token exchange failed with HTTP ${response.status}.`
        ),
        'D360_TOKEN_EXCHANGE_FAILED',
        [
          runtimeMessages.getMessage('error.D360_TOKEN_EXCHANGE_FAILED.3.actions.1'),
          runtimeMessages.getMessage('error.D360_TOKEN_EXCHANGE_FAILED.3.actions.2'),
        ],
        1
      ) as SfError<TokenExchangeErrorData>;
      error.data = { httpStatus: response.status };
      throw error;
    }
    const scopeValue = payload.scopes ?? payload.scope;
    const scopes =
      scopeValue === undefined
        ? undefined
        : Array.isArray(scopeValue)
          ? scopeValue
          : scopeValue.split(/\s+/u).filter(Boolean);
    return {
      jwt: payload.access_token,
      instanceUrl: validateTenantUrl(payload.instance_url, options.env),
      expiresAt: new Date((options.now ?? Date.now)() + payload.expires_in! * 1000).toISOString(),
      scopes,
    };
  } finally {
    await transport.close();
  }
};

export const exchange = async (org: Org, options: TokenExchangeOptions = {}): Promise<DirectToken> =>
  exchangeConnection(org.getConnection(), options);
