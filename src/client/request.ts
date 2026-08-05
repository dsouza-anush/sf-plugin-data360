import { loadCommandMessages } from '../messages.js';
import { performance } from 'node:perf_hooks';
import type { Readable } from 'node:stream';
import { normalizeApiError, type ApiErrorContext } from './errors.js';
import { withRetry } from './retry.js';
import type { HttpMethod, Timing } from '../shared/types.js';
import {
  appendTraceEvent,
  redactTraceString,
  traceCommandReference,
  traceEnabled,
  traceHeaderMetadata,
  traceHeaders,
  tracePayload,
  traceRootForUrl,
} from './trace.js';

const runtimeMessages = loadCommandMessages('data360.runtime.client.request');

export type Transport = <T>(request: {
  method: HttpMethod;
  url: string;
  body?: string | Uint8Array | Readable;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  onResponse?: (status: number, headers: Readonly<Record<string, string>>, body: unknown) => void;
}) => Promise<T>;

export type RequestOptions = {
  method: HttpMethod;
  url: string;
  body?: unknown;
  rawBody?: Uint8Array | (() => Readable);
  contentType?: string;
  headers?: Record<string, string>;
  parseMs: number;
  connectionMs: number;
  now?: () => number;
  onTiming?: (timing: Timing) => void;
  errorContext?: ApiErrorContext;
  signal?: AbortSignal;
  timeoutMs?: number;
  traceRoot?: 'ssot' | 'core' | 'direct';
};

export const request = async <T>(transport: Transport, options: RequestOptions): Promise<T> => {
  if (options.body !== undefined && options.rawBody !== undefined) {
    throw new Error(runtimeMessages.getMessage('error.RUNTIME_0.0'));
  }
  if (options.rawBody !== undefined && !options.contentType) {
    throw new Error(runtimeMessages.getMessage('error.RUNTIME_1.1'));
  }
  const now = options.now ?? performance.now.bind(performance);
  const start = now();
  const tracing = traceEnabled();
  let retryAttempt = 0;
  try {
    return await withRetry(
      async () => {
        const body =
          typeof options.rawBody === 'function'
            ? options.rawBody()
            : (options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)));
        const headers = traceHeaders(
          options.rawBody !== undefined
            ? { 'content-type': options.contentType!, ...options.headers }
            : options.body === undefined
              ? options.headers
              : { 'content-type': 'application/json', ...options.headers }
        );
        const requestPayload = tracing
          ? tracePayload(body && typeof (body as Readable).pipe === 'function' ? '[stream body omitted]' : body)
          : undefined;
        const commandReference = tracing ? traceCommandReference() : undefined;
        const root = tracing ? traceRootForUrl(options.url, options.traceRoot) : undefined;
        const attempt = retryAttempt;
        retryAttempt += 1;
        const attemptStart = performance.now();
        const requestSequence = tracing
          ? await appendTraceEvent({
              type: 'http.request',
              seqRef: commandReference ?? 0,
              method: options.method,
              url: redactTraceString(options.url),
              root,
              headers: traceHeaderMetadata(headers),
              bodyDigest: requestPayload!.digest,
              bodyBytes: requestPayload!.bytes,
              retryAttempt: attempt,
            })
          : undefined;
        let observed: { status: number; headers: Readonly<Record<string, string>>; body: unknown } | undefined;
        try {
          const result = await transport<T>({
            method: options.method,
            url: options.url,
            body,
            headers,
            signal: options.signal,
            timeoutMs: options.timeoutMs,
            onResponse: (status, responseHeaders, responseBody): void => {
              observed = { status, headers: responseHeaders, body: responseBody };
            },
          });
          if (requestSequence !== undefined) {
            const responsePayload = tracePayload(observed?.body ?? result);
            await appendTraceEvent({
              type: 'http.response',
              seqRef: commandReference ?? 0,
              requestRef: requestSequence,
              root,
              status: observed?.status ?? (result === undefined ? 204 : 200),
              statusInferred: observed === undefined,
              durationMs: Math.max(0, performance.now() - attemptStart),
              retryAttempt: attempt,
              headers: traceHeaderMetadata(observed?.headers ?? {}),
              bodyDigest: responsePayload.digest,
              bodyBytes: responsePayload.bytes,
            });
          }
          return result;
        } catch (error) {
          const value = error as {
            status?: number;
            statusCode?: number;
            data?: { httpStatus?: number };
            headers?: Readonly<Record<string, string>>;
            body?: unknown;
          };
          if (requestSequence !== undefined) {
            const responsePayload = tracePayload(value.body ?? error);
            const observedStatus = observed?.status ?? value.statusCode ?? value.status ?? value.data?.httpStatus;
            await appendTraceEvent({
              type: 'http.response',
              seqRef: commandReference ?? 0,
              requestRef: requestSequence,
              root,
              status: observedStatus ?? 0,
              statusInferred: observedStatus === undefined,
              durationMs: Math.max(0, performance.now() - attemptStart),
              retryAttempt: attempt,
              headers: traceHeaderMetadata(observed?.headers ?? value.headers ?? {}),
              bodyDigest: responsePayload.digest,
              bodyBytes: responsePayload.bytes,
            });
          }
          throw error;
        }
      },
      { method: options.method }
    );
  } catch (error) {
    throw normalizeApiError(error, options.url, options.errorContext);
  } finally {
    const requestMs = Math.round(now() - start);
    options.onTiming?.({
      parseMs: options.parseMs,
      connectionMs: options.connectionMs,
      requestMs,
      totalMs: options.parseMs + options.connectionMs + requestMs,
    });
  }
};

export const formatTiming = (timing: Timing): string =>
  `Timing: parse ${timing.parseMs}ms · connection ${timing.connectionMs}ms · request ${timing.requestMs}ms · total ${timing.totalMs}ms`;
