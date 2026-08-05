import { loadCommandMessages } from '../messages.js';
import { Org, SfError, type Connection } from '@salesforce/core';
import { DirectClient } from '../client/directClient.js';
import { TokenCache } from '../client/tokenCache.js';
import { JobCache, type JobCacheEntry } from '../run/jobCache.js';

const runtimeMessages = loadCommandMessages('data360.runtime.ingest.context');

export type IngestCacheEntry = JobCacheEntry & {
  context: { sourceName: string; objectName: string };
  outputInfo?: { operation: 'upsert' | 'delete' };
};

export const directClient = async (
  org: Org,
  connection: Connection,
  timing: ConstructorParameters<typeof DirectClient>[0]['timing']
): Promise<{ client: DirectClient; close: () => Promise<void> }> => {
  const username = org.getUsername();
  if (!username)
    throw new SfError(runtimeMessages.getMessage('error.D360_AUTH_EXPIRED.0'), 'D360_AUTH_EXPIRED', [
      runtimeMessages.getMessage('error.D360_AUTH_EXPIRED.0.actions.1'),
    ]);
  const cache = await TokenCache.create();
  return {
    client: new DirectClient({ username, connection, cache, timing }),
    close: async () => cache.close(),
  };
};

export const resolveIngestJob = async (options: {
  id?: string;
  recent?: boolean;
  org?: Org;
  orgExplicit?: boolean;
  apiVersion?: string;
}): Promise<{ id: string; entry?: IngestCacheEntry; org: Org; connection: Connection; apiVersion: string }> => {
  const cache = await JobCache.create<IngestCacheEntry>('ingest');
  const entry = options.recent ? await cache.latest() : options.id ? await cache.get(options.id) : undefined;
  const id = options.id ?? entry?.id;
  if (!id)
    throw new SfError(runtimeMessages.getMessage('error.D360_NOT_FOUND.1'), 'D360_NOT_FOUND', [
      runtimeMessages.getMessage('error.D360_NOT_FOUND.1.actions.1'),
    ]);
  const org =
    options.orgExplicit === false
      ? entry
        ? await Org.create({ aliasOrUsername: entry.username })
        : undefined
      : (options.org ?? (entry ? await Org.create({ aliasOrUsername: entry.username }) : undefined));
  if (!org)
    throw new SfError(runtimeMessages.getMessage('error.D360_AUTH_EXPIRED.2', [String(id)]), 'D360_AUTH_EXPIRED', [
      runtimeMessages.getMessage('error.D360_AUTH_EXPIRED.2.actions.1'),
    ]);
  const connection = org.getConnection(options.apiVersion ?? entry?.apiVersion);
  const apiVersion = options.apiVersion ?? entry?.apiVersion ?? connection.version;
  if (!apiVersion)
    throw new SfError(runtimeMessages.getMessage('error.D360_API_ERROR.3'), 'D360_API_ERROR', [
      runtimeMessages.getMessage('error.D360_API_ERROR.3.actions.1'),
    ]);
  return { id, entry, org, connection, apiVersion };
};
