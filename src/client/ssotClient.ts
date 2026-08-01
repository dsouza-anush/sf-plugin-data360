import type { Connection } from '@salesforce/core';
import type { Readable } from 'node:stream';
import { request, type RequestOptions } from './request.js';
import { getUserAgent } from './userAgent.js';
import { buildApiPath, type ApiRoot } from '../shared/path.js';
import type { HttpMethod } from '../shared/types.js';

export type SsotRequest = Omit<
  RequestOptions,
  'url' | 'parseMs' | 'connectionMs' | 'onTiming' | 'rawBody' | 'contentType' | 'traceRoot'
> & {
  endpoint: string;
  query?: Readonly<Record<string, string | number | boolean | undefined>>;
  root?: ApiRoot;
};
export type SsotTiming = Pick<RequestOptions, 'parseMs' | 'connectionMs' | 'onTiming'>;

const appendQuery = (
  path: string,
  query: Readonly<Record<string, string | number | boolean | undefined>> = {}
): string => {
  const [pathname, existing = ''] = path.split('?', 2);
  const parameters = new URLSearchParams(existing);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  const encoded = parameters.toString();
  return encoded ? `${pathname}?${encoded}` : pathname;
};

export class SsotClient {
  public constructor(
    private readonly connection: Connection,
    private readonly apiVersion: string,
    private readonly timing: SsotTiming
  ) {}

  public async request<T>(options: SsotRequest): Promise<T> {
    return request<T>(
      <R>(value: {
        method: HttpMethod;
        url: string;
        body?: string | Uint8Array | Readable;
        headers?: Record<string, string>;
        signal?: AbortSignal;
        timeoutMs?: number;
      }) =>
        this.connection.request<R>(
          {
            method: value.method,
            url: value.url,
            body: typeof value.body === 'string' ? value.body : undefined,
            headers: value.headers,
          },
          { followRedirect: false, ...(value.timeoutMs === undefined ? {} : { timeout: value.timeoutMs }) }
        ),
      {
        ...options,
        ...this.timing,
        url: appendQuery(buildApiPath(this.apiVersion, options.endpoint, options.root), options.query),
        headers: { 'user-agent': getUserAgent(), ...options.headers },
        traceRoot: options.root === 'core' ? 'core' : 'ssot',
      }
    );
  }

  public get<T>(endpoint: string): Promise<T> {
    return this.request<T>({ method: 'GET', endpoint });
  }

  public post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>({ method: 'POST', endpoint, body });
  }
}
