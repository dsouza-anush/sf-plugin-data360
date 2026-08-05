import { loadCommandMessages } from '../messages.js';
import { posix } from 'node:path';

const runtimeMessages = loadCommandMessages('data360.runtime.shared.path');

export type ApiRoot = 'ssot' | 'core';

const assertSafeEndpoint = (endpoint: string, rootKind: ApiRoot): void => {
  let candidate = endpoint.split(/[?#]/u, 1)[0];
  for (let depth = 0; depth < 16; depth += 1) {
    if (candidate.includes('\\') || candidate.split('/').some((segment) => segment === '..')) {
      throw new Error(runtimeMessages.getMessage('error.RUNTIME_1.1', [String(rootKind), String(endpoint)]));
    }
    if (!candidate.includes('%')) return;
    let decoded: string;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      throw new Error(runtimeMessages.getMessage('error.RUNTIME_1.1', [String(rootKind), String(endpoint)]));
    }
    if (decoded === candidate) return;
    candidate = decoded;
  }
  throw new Error(runtimeMessages.getMessage('error.RUNTIME_1.1', [String(rootKind), String(endpoint)]));
};

export const buildApiPath = (apiVersion: string, endpoint: string, rootKind: ApiRoot = 'ssot'): string => {
  if (!/^\d+\.\d+$/.test(apiVersion))
    throw new Error(runtimeMessages.getMessage('error.RUNTIME_0.0', [String(apiVersion)]));
  const versionRoot = `/services/data/v${apiVersion}`;
  const root = rootKind === 'ssot' ? `${versionRoot}/ssot` : versionRoot;
  assertSafeEndpoint(endpoint, rootKind);
  const absolute = endpoint.startsWith('/services/') ? endpoint : `${root}/${endpoint.replace(/^\/+/, '')}`;
  const normalized = posix.normalize(absolute);
  if (normalized !== root && !normalized.startsWith(`${root}/`)) {
    throw new Error(runtimeMessages.getMessage('error.RUNTIME_1.1', [String(rootKind), String(endpoint)]));
  }

  return normalized;
};

export const buildSsotPath = (apiVersion: string, endpoint: string): string =>
  buildApiPath(apiVersion, endpoint, 'ssot');
