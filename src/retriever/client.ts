import type { SsotClient } from '../client/ssotClient.js';
import { listAllSsot } from '../shared/listAll.js';
import { resolveResourceKey } from '../shared/nameResolver.js';

type Item = Record<string, unknown>;

export const listRetrievers = (client: SsotClient): Promise<Item[]> =>
  listAllSsot(client, {
    endpoint: '/machine-learning/retrievers',
    arrayKey: 'retrievers',
  });

export const resolveRetrieverKey = async (value: string, items: readonly Item[]): Promise<string> => {
  const qualified = items.map((item) => ({
    ...item,
    qualifiedName:
      typeof item.namespace === 'string' && item.namespace ? `${item.namespace}__${String(item.name)}` : item.name,
  }));
  return resolveResourceKey(value, {
    idKind: 'idOrApiName',
    nameFields: ['name', 'label', 'qualifiedName'],
    apiNameField: 'qualifiedName',
    list: async () => qualified,
  });
};
