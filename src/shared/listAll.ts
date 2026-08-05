import { paginate, type Page } from '../client/pagination.js';
import type { SsotClient } from '../client/ssotClient.js';

type Item = Record<string, unknown>;

const asRecord = (value: unknown): Item =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Item) : {};

const arrayAtPath = (value: unknown, path: string): Item[] | undefined => {
  const candidate = path.split('.').reduce<unknown>((current, segment) => asRecord(current)[segment], value);
  return Array.isArray(candidate) ? candidate.map(asRecord) : undefined;
};

const firstString = (...values: unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === 'string' && value.length > 0);

const firstNumber = (...values: unknown[]): number | undefined =>
  values.find((value): value is number => typeof value === 'number');

export const listAllSsot = async (
  client: SsotClient,
  options: {
    endpoint: string;
    arrayKey: string | string[];
    query?: Record<string, string | number | boolean | undefined>;
    limit?: number;
  }
): Promise<Item[]> => {
  const result: Item[] = [];
  const iterator = paginate<Item>(
    async ({ offset, pageSize, cursor, nextPageUrl }): Promise<Page<Item>> => {
      const response = await client.request<Item>({
        method: 'GET',
        endpoint: nextPageUrl ?? options.endpoint,
        query: nextPageUrl
          ? undefined
          : { ...options.query, offset, limit: pageSize, batchSize: pageSize, nextBatchId: cursor },
      });
      const arrayKeys = Array.isArray(options.arrayKey) ? options.arrayKey : [options.arrayKey];
      const collection = asRecord(response.collection);
      const data = [...arrayKeys, 'collection.items']
        .map((key) => arrayAtPath(response, key))
        .find((value): value is Item[] => value !== undefined);
      return {
        data: data ?? [],
        totalSize: firstNumber(response.totalSize, response.total, collection.totalSize, collection.total),
        nextBatchId: firstString(response.nextBatchId, collection.nextBatchId),
        nextPageUrl: firstString(response.nextPageUrl, collection.nextPageUrl),
      };
    },
    { limit: options.limit }
  );
  for await (const item of iterator) result.push(item);
  return result;
};
