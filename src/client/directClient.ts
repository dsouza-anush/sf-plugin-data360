import { loadCommandMessages } from '../messages.js';
import { SfError, type Connection } from '@salesforce/core';
import type { TokenCache } from './tokenCache.js';
import { posix } from 'node:path';
import type { Readable } from 'node:stream';
import { resolveTestTenantUrl } from './testTenantUrl.js';
import { request, type RequestOptions } from './request.js';
import { getUserAgent } from './userAgent.js';
import { createProxyAwareFetch } from './proxyFetch.js';
import { validateTenantUrl, type DirectToken } from './tokenExchange.js';
import type { HttpMethod } from '../shared/types.js';

const runtimeMessages = loadCommandMessages('data360.runtime.client.directClient');

export type DirectRequest = Omit<RequestOptions, 'url' | 'parseMs' | 'connectionMs' | 'onTiming' | 'traceRoot'> & {
  endpoint: string;
  query?: Readonly<Record<string, string | number | boolean | undefined>>;
};

export type DirectClientOptions = {
  username: string;
  connection: Connection;
  cache: TokenCache;
  useCache?: boolean;
  timing?: Pick<RequestOptions, 'parseMs' | 'connectionMs' | 'onTiming'>;
  fetch?: typeof fetch;
  env?: Readonly<Record<string, string | undefined>>;
  token?: DirectToken;
};

export class DirectClient {
  public constructor(private readonly options: DirectClientOptions) {}

  public async request<T>(options: DirectRequest): Promise<T> {
    try {
      return await this.send<T>(options);
    } catch (error) {
      if ((error as { data?: { httpStatus?: number } }).data?.httpStatus !== 401) throw error;
      if (this.options.token) throw error;
      await this.options.cache.invalidate(this.options.username);
      return this.send<T>(options);
    }
  }

  public get<T>(endpoint: string): Promise<T> {
    return this.request<T>({ method: 'GET', endpoint });
  }

  public post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>({ method: 'POST', endpoint, body });
  }

  public async *paginate<T>(_options: {
    endpoint: string;
    query?: Readonly<Record<string, string | number | boolean | undefined>>;
    pageSize?: number;
  }): AsyncGenerator<T[]> {
    const pageSize = _options.pageSize ?? 200;
    let offset = 0;
    for (;;) {
      const page = await this.request<{
        data?: T[];
        records?: T[];
        totalSize?: number;
        nextPageUrl?: string;
      }>({
        method: 'GET',
        endpoint: _options.endpoint,
        query: { ..._options.query, offset, limit: pageSize, batchSize: pageSize },
      });
      const rows = page.data ?? page.records ?? [];
      yield rows;
      offset += rows.length;
      if (rows.length === 0 || rows.length < pageSize || (page.totalSize !== undefined && offset >= page.totalSize))
        return;
    }
  }

  private async send<T>(options: DirectRequest): Promise<T> {
    const callerHeaders = options.headers ?? {};
    for (const name of Object.keys(callerHeaders)) {
      if (['authorization', 'host', 'content-length'].includes(name.toLowerCase())) {
        throw new SfError(runtimeMessages.getMessage('error.D360_API_ERROR.0', [String(name)]), 'D360_API_ERROR', [
          runtimeMessages.getMessage('error.D360_API_ERROR.0.actions.1'),
        ]);
      }
    }
    const token =
      this.options.token ??
      (await this.options.cache.get(this.options.username, this.options.connection, {
        useCache: this.options.useCache,
      }));
    const override = resolveTestTenantUrl(this.options.env);
    const base = override ?? new URL(validateTenantUrl(token.instanceUrl, this.options.env));
    const path = appendQuery(resolveDirectPath(options.endpoint), options.query);
    const requiredScope = scopeForPath(path);
    const transport = createProxyAwareFetch({ fetch: this.options.fetch, env: this.options.env });
    try {
      return await request<T>(
        async <R>(transportRequest: {
          method: HttpMethod;
          url: string;
          body?: string | Uint8Array | Readable;
          headers?: Record<string, string>;
          signal?: AbortSignal;
          onResponse?: (status: number, headers: Readonly<Record<string, string>>, body: unknown) => void;
        }): Promise<R> => {
          const { method, url, body, headers, signal } = transportRequest;
          const init: RequestInit & { duplex?: 'half' } = {
            method,
            body: body as BodyInit | undefined,
            headers,
            signal,
          };
          if (body && typeof (body as Readable).pipe === 'function') init.duplex = 'half';
          const response = await transport.fetch(url, init);
          const text = await response.text();
          let payload: unknown;
          if (text) {
            try {
              payload = JSON.parse(text) as unknown;
            } catch {
              payload = text;
            }
          }
          transportRequest.onResponse?.(response.status, Object.fromEntries(response.headers.entries()), payload);
          if (!response.ok) {
            throw {
              statusCode: response.status,
              body: payload,
              headers: Object.fromEntries(response.headers.entries()),
            };
          }
          return payload as R;
        },
        {
          ...options,
          ...(this.options.timing ?? { parseMs: 0, connectionMs: 0 }),
          url: new URL(path, base).toString(),
          errorContext: { family: 'direct', requiredScope },
          headers: {
            'user-agent': getUserAgent(),
            ...callerHeaders,
            authorization: `Bearer ${token.jwt}`,
          },
          traceRoot: 'direct',
        }
      );
    } finally {
      await transport.close();
    }
  }
}

const appendQuery = (
  path: string,
  query: Readonly<Record<string, string | number | boolean | undefined>> = {}
): string => {
  const url = new URL(path, 'https://direct.invalid');
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
};
const scopeForPath = (path: string): string => {
  const pathname = new URL(path, 'https://direct.invalid').pathname;
  if (pathname.startsWith('/api/v1/ingest/')) return 'cdp_ingest_api';
  if (/^\/api\/v(?:2|3)\/query(?:\/|$)/u.test(pathname)) return 'cdp_query_api';
  if (pathname.startsWith('/api/v1/profile/')) return 'cdp_profile_api';
  return 'cdp_api';
};

export const resolveDirectPath = (endpoint: string): string => {
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//iu.test(endpoint)) throw new Error(runtimeMessages.getMessage('error.RUNTIME_1.1'));
  let decoded = endpoint;
  try {
    for (let index = 0; index < 10; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    throw new Error(runtimeMessages.getMessage('error.RUNTIME_2.2'));
  }
  if (decoded.includes('\\') || decoded.split('/').includes('..'))
    throw new Error(runtimeMessages.getMessage('error.RUNTIME_3.3'));
  const [path, suffix = ''] = endpoint.split(/(?=[?#])/u, 2);
  if (/^\/api\/v\d+(?:\/|$)/u.test(path)) return `${posix.normalize(path)}${suffix}`;
  const normalized = posix.normalize(`/api/v1/${path.replace(/^\/+/u, '')}`);
  if (!normalized.startsWith('/api/v1/')) throw new Error(runtimeMessages.getMessage('error.RUNTIME_4.4'));
  return `${normalized}${suffix}`;
};
export type DirectMethod = HttpMethod;
