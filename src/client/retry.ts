import { setTimeout as sleep } from 'node:timers/promises';
import type { HttpMethod } from '../shared/types.js';

export type RetryOptions = {
  method: HttpMethod;
  delaysMs?: number[];
  random?: () => number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<unknown>;
};

const statusOf = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = error as { status?: unknown; statusCode?: unknown };
  return typeof value.statusCode === 'number'
    ? value.statusCode
    : typeof value.status === 'number'
      ? value.status
      : undefined;
};

const retryAfterMs = (error: unknown, now: () => number): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const outer = error as { headers?: unknown; response?: { headers?: unknown } };
  const headers = outer.headers ?? outer.response?.headers;
  if (typeof headers !== 'object' || headers === null) return undefined;
  const entries = Object.entries(headers as Record<string, unknown>);
  const value = entries.find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
  if (typeof value !== 'string') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now());
};

export const withRetry = async <T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> => {
  const delays = options.delaysMs ?? [1000, 2000, 4000];
  const retryableMethod = options.method === 'GET' || options.method === 'HEAD';
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? sleep;
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      const status = statusOf(error);
      if (!retryableMethod || (status !== 429 && status !== 503) || attempt >= delays.length) throw error;
      const jitter = options.random?.() ?? Math.random();
      const delay = retryAfterMs(error, now) ?? Math.round(delays[attempt] * (0.75 + jitter * 0.5));
      await wait(delay);
      attempt += 1;
    }
  }
};
