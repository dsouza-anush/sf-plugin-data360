import { loadCommandMessages } from '../messages.js';
import { SfError } from '@salesforce/core';
import {
  Agent,
  ProxyAgent,
  fetch as undiciFetch,
  type Dispatcher,
  type RequestInit as UndiciRequestInit,
} from 'undici';

const runtimeMessages = loadCommandMessages('data360.runtime.client.proxyFetch');

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ProxyDiagnostics = {
  enabled: boolean;
  httpProxyConfigured: boolean;
  httpsProxyConfigured: boolean;
  noProxyConfigured: boolean;
};

export type ProxyAwareFetch = {
  fetch: FetchLike;
  close: () => Promise<void>;
  diagnostics: ProxyDiagnostics;
};

type ProxyValues = {
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
};

type NoProxyEntry = {
  hostname: string;
  port?: number;
  suffix: boolean;
};

const DEFAULT_PORTS: Readonly<Record<string, number>> = {
  'http:': 80,
  'https:': 443,
};

const hasOwn = (value: Readonly<Record<string, string | undefined>>, name: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, name);

const readProxyVariable = (
  env: Readonly<Record<string, string | undefined>>,
  lowerName: string,
  upperName: string
): string => (hasOwn(env, lowerName) ? env[lowerName] : env[upperName]) ?? '';

const resolveProxyValues = (env: Readonly<Record<string, string | undefined>>): ProxyValues => ({
  httpProxy: readProxyVariable(env, 'http_proxy', 'HTTP_PROXY'),
  httpsProxy: readProxyVariable(env, 'https_proxy', 'HTTPS_PROXY'),
  noProxy: readProxyVariable(env, 'no_proxy', 'NO_PROXY'),
});

const normalizeHostname = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '');

const parseNoProxyEntry = (value: string): NoProxyEntry | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  let hostname = trimmed;
  let port: number | undefined;
  const ipv6 = trimmed.match(/^\[([^\]]+)\](?::(\d+))?$/u);
  if (ipv6) {
    hostname = ipv6[1];
    port = ipv6[2] ? Number.parseInt(ipv6[2], 10) : undefined;
  } else {
    const hostAndPort = trimmed.match(/^([^:]+):(\d+)$/u);
    if (hostAndPort) {
      hostname = hostAndPort[1];
      port = Number.parseInt(hostAndPort[2], 10);
    }
  }

  const suffix = hostname.startsWith('.') || hostname.startsWith('*.');
  hostname = normalizeHostname(hostname.replace(/^\*?\./u, ''));
  if (!hostname || (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535))) return undefined;
  return { hostname, port, suffix };
};

/** Returns true when an absolute HTTP(S) URL is covered by the configured NO_PROXY value. */
export const shouldBypassProxy = (url: URL, noProxy: string): boolean => {
  const entries = noProxy.split(/[\s,]+/u).filter(Boolean);
  if (entries.includes('*')) return true;

  const hostname = normalizeHostname(url.hostname);
  const port = url.port ? Number.parseInt(url.port, 10) : DEFAULT_PORTS[url.protocol];
  return entries.some((value) => {
    const entry = parseNoProxyEntry(value);
    if (!entry || (entry.port !== undefined && entry.port !== port)) return false;
    return entry.suffix
      ? hostname === entry.hostname || hostname.endsWith(`.${entry.hostname}`)
      : hostname === entry.hostname;
  });
};

export const inspectProxyEnvironment = (
  env: Readonly<Record<string, string | undefined>> = process.env
): ProxyDiagnostics => {
  const values = resolveProxyValues(env);
  return {
    enabled: Boolean(values.httpProxy || values.httpsProxy),
    httpProxyConfigured: Boolean(values.httpProxy),
    httpsProxyConfigured: Boolean(values.httpsProxy),
    noProxyConfigured: Boolean(values.noProxy),
  };
};

const proxyError = (): SfError =>
  new SfError(runtimeMessages.getMessage('error.D360_API_ERROR.0'), 'D360_API_ERROR', [
    runtimeMessages.getMessage('error.D360_API_ERROR.0.actions.1'),
    runtimeMessages.getMessage('error.D360_API_ERROR.0.actions.2'),
  ]);

const targetUrl = (input: string | URL | Request): URL =>
  new URL(typeof input === 'string' || input instanceof URL ? input : input.url);

const validateProxyUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      throw new Error(runtimeMessages.getMessage('error.unsupportedProxyUrl'));
    }
    return url.toString();
  } catch {
    throw proxyError();
  }
};

/**
 * Creates an isolated proxy-aware fetch transport. All requests reject redirects so credentials are never replayed to a
 * redirected origin. The dispatcher is lazy and local to this transport; this never changes Undici's global dispatcher.
 */
export const createProxyAwareFetch = (
  options: {
    fetch?: FetchLike;
    env?: Readonly<Record<string, string | undefined>>;
  } = {}
): ProxyAwareFetch => {
  const env = options.env ?? process.env;
  const values = resolveProxyValues(env);
  const diagnostics = inspectProxyEnvironment(env);
  let directAgent: Agent | undefined;
  const proxyAgents = new Map<string, ProxyAgent>();
  let closing: Promise<void> | undefined;

  if (options.fetch || !diagnostics.enabled) {
    const fetchImpl = options.fetch ?? ((input, init): Promise<Response> => globalThis.fetch(input, init));
    return {
      fetch: (input, init): Promise<Response> => fetchImpl(input, { ...(init ?? {}), redirect: 'error' }),
      close: async (): Promise<void> => undefined,
      diagnostics,
    };
  }

  const dispatcherFor = (url: URL): Dispatcher => {
    const configuredProxy = url.protocol === 'https:' ? values.httpsProxy || values.httpProxy : values.httpProxy;
    if (!configuredProxy || shouldBypassProxy(url, values.noProxy)) {
      directAgent ??= new Agent();
      return directAgent;
    }

    const proxyUrl = validateProxyUrl(configuredProxy);
    const existing = proxyAgents.get(proxyUrl);
    if (existing) return existing;
    try {
      const created = new ProxyAgent({ uri: proxyUrl });
      proxyAgents.set(proxyUrl, created);
      return created;
    } catch {
      throw proxyError();
    }
  };

  const fetchWithProxy: FetchLike = async (input, init): Promise<Response> => {
    const dispatcher = dispatcherFor(targetUrl(input));
    return (await undiciFetch(
      input as string | URL,
      {
        ...(init ?? {}),
        redirect: 'error',
        dispatcher,
      } as unknown as UndiciRequestInit
    )) as unknown as Response;
  };

  return {
    fetch: fetchWithProxy,
    close: async (): Promise<void> => {
      closing ??= Promise.all([
        ...(directAgent ? [directAgent.close()] : []),
        ...[...proxyAgents.values()].map(async (agent) => agent.close()),
      ]).then(() => undefined);
      await closing;
    },
    diagnostics,
  };
};
