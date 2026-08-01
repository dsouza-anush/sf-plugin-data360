import { loadCommandMessages } from '../messages.js';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { posix } from 'node:path';
import type { Readable } from 'node:stream';
import type { Connection } from '@salesforce/core';
import { createProxyAwareFetch, type FetchLike } from '../client/proxyFetch.js';
import type { TokenCache } from '../client/tokenCache.js';
import { resolveDirectPath } from '../client/directClient.js';
import { resolveTestTenantUrl } from '../client/testTenantUrl.js';
import { validateTenantUrl } from '../client/tokenExchange.js';
import { writeFileAtomic } from '../shared/atomicFile.js';
import type { Timing } from '../shared/types.js';
import {
  appendTraceEvent,
  redactTraceString,
  traceCommandReference,
  traceEnabled,
  traceHeaderMetadata,
  traceHeaders,
  tracePayload,
} from '../client/trace.js';

const runtimeMessages = loadCommandMessages('data360.runtime.api.rawRequest');

export type RawMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type { FetchLike } from '../client/proxyFetch.js';

const forbiddenHeaders = new Set(['authorization', 'host', 'content-length']);
const TRACE_BODY_LIMIT = 1024 * 1024;

const tracedFetch = async (options: {
  transport: ReturnType<typeof createProxyAwareFetch>;
  url: URL;
  method: RawMethod;
  headers: Record<string, string>;
  body?: Buffer;
  root: 'core' | 'direct';
  retryAttempt: number;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<Response> => {
  if (!traceEnabled(options.env)) {
    return options.transport.fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body as unknown as BodyInit,
    });
  }
  const headers = traceHeaders(options.headers, options.env);
  const commandReference = traceCommandReference(options.env);
  const requestPayload = tracePayload(options.body?.toString('utf8'));
  const startedAt = performance.now();
  const requestSequence = await appendTraceEvent(
    {
      type: 'http.request',
      seqRef: commandReference ?? 0,
      method: options.method,
      url: redactTraceString(options.url.toString()),
      root: options.root,
      headers: traceHeaderMetadata(headers),
      bodyDigest: requestPayload.digest,
      bodyBytes: requestPayload.bytes,
      retryAttempt: options.retryAttempt,
    },
    options.env
  );
  try {
    const response = await options.transport.fetch(options.url, {
      method: options.method,
      headers,
      body: options.body as unknown as BodyInit,
    });
    const declaredLength = response.headers.get('content-length');
    const contentLength = declaredLength === null ? undefined : Number(declaredLength);
    let traceBody: unknown =
      contentLength === undefined
        ? '<omitted:unknown-length-body>'
        : contentLength > TRACE_BODY_LIMIT
          ? `<omitted:${contentLength}-byte-body>`
          : '';
    if (contentLength !== undefined && contentLength <= TRACE_BODY_LIMIT) {
      try {
        traceBody = await response.clone().text();
      } catch {
        traceBody = '<unavailable-response-body>';
      }
    }
    const responsePayload = tracePayload(traceBody);
    if (requestSequence !== undefined)
      await appendTraceEvent(
        {
          type: 'http.response',
          seqRef: commandReference ?? 0,
          requestRef: requestSequence,
          root: options.root,
          status: response.status,
          statusInferred: false,
          durationMs: Math.max(0, performance.now() - startedAt),
          retryAttempt: options.retryAttempt,
          headers: traceHeaderMetadata(response.headers),
          bodyDigest: responsePayload.digest,
          bodyBytes: responsePayload.bytes,
        },
        options.env
      );
    return response;
  } catch (error) {
    const responsePayload = tracePayload(error);
    if (requestSequence !== undefined)
      await appendTraceEvent(
        {
          type: 'http.response',
          seqRef: commandReference ?? 0,
          requestRef: requestSequence,
          root: options.root,
          status: 0,
          statusInferred: true,
          durationMs: Math.max(0, performance.now() - startedAt),
          retryAttempt: options.retryAttempt,
          headers: {},
          bodyDigest: responsePayload.digest,
          bodyBytes: responsePayload.bytes,
        },
        options.env
      );
    throw error;
  }
};

export const resolveRawPath = (apiVersion: string, endpoint: string): string => {
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//iu.test(endpoint)) throw new Error(runtimeMessages.getMessage('error.RUNTIME_0.0'));
  const [path, suffix = ''] = endpoint.split(/(?=[?#])/u, 2);
  let decoded = path;
  try {
    for (let index = 0; index < 10; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    throw new Error(runtimeMessages.getMessage('error.RUNTIME_1.1'));
  }
  if (decoded.includes('\\') || decoded.split('/').includes('..'))
    throw new Error(runtimeMessages.getMessage('error.RUNTIME_2.2'));

  if (path.startsWith('/services/')) {
    const normalized = posix.normalize(path);
    if (!normalized.startsWith('/services/')) throw new Error(runtimeMessages.getMessage('error.RUNTIME_3.3'));
    return `${normalized}${suffix}`;
  }

  const root = `/services/data/v${apiVersion}/ssot`;
  const normalized = posix.normalize(`${root}/${path.replace(/^\/+/u, '')}`);
  if (normalized !== root && !normalized.startsWith(`${root}/`)) {
    throw new Error(runtimeMessages.getMessage('error.RUNTIME_4.4'));
  }
  return `${normalized}${suffix}`;
};

export const parseHeaders = (values: string[]): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf(':');
    if (separator <= 0) throw new Error(runtimeMessages.getMessage('error.RUNTIME_5.5', [String(value)]));
    const name = value.slice(0, separator).trim();
    if (forbiddenHeaders.has(name.toLowerCase()))
      throw new Error(runtimeMessages.getMessage('error.RUNTIME_6.6', [String(name)]));
    headers[name] = value.slice(separator + 1).trim();
  }
  return headers;
};

export const RAW_BODY_MAX_BYTES = 10 * 1024 * 1024;

const assertRawBodySize = (body: Buffer): Buffer => {
  if (body.byteLength > RAW_BODY_MAX_BYTES) throw new Error(runtimeMessages.getMessage('error.RUNTIME_8.8'));
  return body;
};

const readStdin = async (stdin: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.byteLength;
    if (bytes > RAW_BODY_MAX_BYTES) throw new Error(runtimeMessages.getMessage('error.RUNTIME_8.8'));
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

export const resolveRawBody = async (
  body: string | undefined,
  stdin: Readable = process.stdin
): Promise<Buffer | undefined> => {
  if (body === undefined) return undefined;
  if (body === '-') return readStdin(stdin);
  if (body.startsWith('@')) return assertRawBodySize(await readFile(body.slice(1)));
  return assertRawBodySize(Buffer.from(body));
};

export const executeRawRequest = async (
  connection: Connection,
  options: {
    apiVersion: string;
    endpoint: string;
    method: RawMethod;
    headers: string[];
    body?: string;
    timing?: { parseMs: number; connectionMs: number; onTiming?: (timing: Timing) => void };
    env?: Readonly<Record<string, string | undefined>>;
  },
  fetchImpl?: FetchLike
): Promise<Response> => {
  await connection.refreshAuth();
  const path = resolveRawPath(options.apiVersion, options.endpoint);
  const token = connection.accessToken;
  if (!token) throw new Error(runtimeMessages.getMessage('error.RUNTIME_7.7'));
  const body = await resolveRawBody(options.body);
  const transport = createProxyAwareFetch({ fetch: fetchImpl, env: options.env });
  const start = performance.now();
  try {
    return await tracedFetch({
      transport,
      url: new URL(path, connection.instanceUrl),
      method: options.method,
      headers: { ...parseHeaders(options.headers), authorization: `Bearer ${token}` },
      body,
      root: 'core',
      retryAttempt: 0,
      env: options.env,
    });
  } finally {
    void transport.close().catch(() => undefined);
    const requestMs = Math.round(performance.now() - start);
    options.timing?.onTiming?.({
      parseMs: options.timing.parseMs,
      connectionMs: options.timing.connectionMs,
      requestMs,
      totalMs: options.timing.parseMs + options.timing.connectionMs + requestMs,
    });
  }
};

export const executeRawDirectRequest = async (
  connection: Connection,
  cache: TokenCache,
  options: {
    username: string;
    endpoint: string;
    method: RawMethod;
    headers: string[];
    body?: string;
    useCache?: boolean;
    timing?: { parseMs: number; connectionMs: number; onTiming?: (timing: Timing) => void };
    env?: Readonly<Record<string, string | undefined>>;
  },
  fetchImpl?: FetchLike
): Promise<Response> => {
  const body = await resolveRawBody(options.body);
  const requestHeaders = parseHeaders(options.headers);
  const transport = createProxyAwareFetch({ fetch: fetchImpl, env: options.env });
  const start = performance.now();
  let retryAttempt = 0;
  const send = async (): Promise<Response> => {
    const token = await cache.get(options.username, connection, { useCache: options.useCache });
    const base = resolveTestTenantUrl(options.env) ?? new URL(validateTenantUrl(token.instanceUrl, options.env));
    const attempt = retryAttempt;
    retryAttempt += 1;
    return tracedFetch({
      transport,
      url: new URL(resolveDirectPath(options.endpoint), base),
      method: options.method,
      headers: { ...requestHeaders, authorization: `Bearer ${token.jwt}` },
      body,
      root: 'direct',
      retryAttempt: attempt,
      env: options.env,
    });
  };
  try {
    const first = await send();
    if (first.status !== 401) return first;
    await first.body?.cancel();
    await cache.invalidate(options.username);
    return send();
  } finally {
    void transport.close().catch(() => undefined);
    const requestMs = Math.round(performance.now() - start);
    options.timing?.onTiming?.({
      parseMs: options.timing.parseMs,
      connectionMs: options.timing.connectionMs,
      requestMs,
      totalMs: options.timing.parseMs + options.timing.connectionMs + requestMs,
    });
  }
};

export const responseHeaderBlock = (response: Response): string => {
  const status = `HTTP ${response.status} ${response.statusText}`.trimEnd();
  const headers = [...response.headers.entries()].map(([name, value]) => `${name}: ${value}`);
  return `${status}\n${headers.join('\n')}\n\n`;
};

export const writeResponseFile = async (path: string, bytes: Uint8Array): Promise<void> => {
  await writeFileAtomic(path, bytes);
};
