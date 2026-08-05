import { loadCommandMessages } from '../messages.js';
import { Org, SfError, type Connection } from '@salesforce/core';
import { resolveCommandDataSpace } from '../configMeta.js';
import { QueryJobCache } from './queryJobCache.js';
import type { QueryJobCacheEntry } from './types.js';

const runtimeMessages = loadCommandMessages('data360.runtime.run.queryContext');

export type ResolveQueryContextOptions = {
  queryId?: string;
  useMostRecent?: boolean;
  targetOrg?: Org;
  apiVersion?: string;
  dataSpace?: string;
};

export type QueryContext = {
  queryId: string;
  entry?: QueryJobCacheEntry;
  connection: Connection;
  apiVersion: string;
  dataSpace: string;
};

export const resolveQueryContext = async (options: ResolveQueryContextOptions): Promise<QueryContext> => {
  const cache = await QueryJobCache.create();
  const entry = options.useMostRecent
    ? await cache.latest(options.targetOrg?.getUsername())
    : options.queryId
      ? await cache.get(options.queryId)
      : undefined;
  const queryId = options.queryId ?? entry?.id;
  if (!queryId) {
    throw new SfError(runtimeMessages.getMessage('error.D360_NOT_FOUND.0'), 'D360_NOT_FOUND', [
      runtimeMessages.getMessage('error.D360_NOT_FOUND.0.actions.1'),
    ]);
  }
  const org = options.targetOrg ?? (entry ? await Org.create({ aliasOrUsername: entry.username }) : undefined);
  if (!org) {
    throw new SfError(runtimeMessages.getMessage('error.D360_AUTH_EXPIRED.1', [String(queryId)]), 'D360_AUTH_EXPIRED', [
      runtimeMessages.getMessage('error.D360_AUTH_EXPIRED.1.actions.1', [String(queryId)]),
    ]);
  }
  const connection = org.getConnection(options.apiVersion ?? entry?.apiVersion);
  const apiVersion = options.apiVersion ?? entry?.apiVersion ?? connection.version;
  if (!apiVersion) {
    throw new SfError(runtimeMessages.getMessage('error.D360_API_ERROR.2'), 'D360_API_ERROR', [
      runtimeMessages.getMessage('error.D360_API_ERROR.2.actions.1'),
    ]);
  }
  return {
    queryId,
    entry,
    connection,
    apiVersion,
    dataSpace:
      options.dataSpace ?? entry?.dataSpace ?? (await resolveCommandDataSpace({ flagValue: options.dataSpace })),
  };
};
