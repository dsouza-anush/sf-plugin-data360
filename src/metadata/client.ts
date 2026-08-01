import { loadCommandMessages } from '../messages.js';
import { SfError } from '@salesforce/core';
import type { EntityMetadata } from './types.js';

const runtimeMessages = loadCommandMessages('data360.runtime.metadata.client');

export type MetadataTransport = {
  get<T>(endpoint: string): Promise<T>;
};

type ListResponse = {
  done?: boolean;
  metadata?: EntityMetadata[];
  nextPageUrl?: string;
  nextBatchId?: string;
  currentPageUrl?: string;
  offset?: number;
};
type GetResponse = { metadata?: EntityMetadata[] };

export class MetadataClient {
  public constructor(private readonly transport: MetadataTransport) {}

  public async list(options: {
    dataSpace: string;
    entityType?: string;
    entityCategory?: string;
    limit: number;
    all: boolean;
  }): Promise<EntityMetadata[]> {
    const filteredRequest = Boolean(options.entityType || options.entityCategory);
    const query = new URLSearchParams({ dataspace: options.dataSpace });
    if (options.entityType) query.set('entityType', options.entityType);
    if (options.entityCategory) query.set('entityCategory', options.entityCategory);
    const initialEndpoint = `${filteredRequest ? '/metadata-entities' : '/metadata'}?${query.toString()}`;
    const entities: EntityMetadata[] = [];
    const seen = new Set<string>();
    let endpoint: string | undefined = initialEndpoint;
    while (endpoint) {
      if (seen.has(endpoint))
        throw new SfError(runtimeMessages.getMessage('error.D360_API_ERROR.0'), 'D360_API_ERROR', [
          runtimeMessages.getMessage('error.D360_API_ERROR.0.actions.1'),
        ]);
      seen.add(endpoint);
      const response: ListResponse = await this.transport.get<ListResponse>(endpoint);
      entities.push(...(response.metadata ?? []));
      if (!options.all || response.done === true) break;
      endpoint = this.continuation(response, initialEndpoint);
    }
    const filtered = entities.filter(
      (entity) =>
        (!options.entityType || entity.type === options.entityType) &&
        (!options.entityCategory || entity.category === options.entityCategory)
    );
    return options.all ? filtered : filtered.slice(0, options.limit);
  }

  public async get(name: string, dataSpace: string): Promise<EntityMetadata> {
    const query = new URLSearchParams({ entityName: name, dataspace: dataSpace });
    const response = await this.transport.get<GetResponse>(`/metadata?${query.toString()}`);
    const entities = response.metadata ?? [];
    if (entities.length === 0) {
      throw new SfError(runtimeMessages.getMessage('error.D360_NOT_FOUND.1', [String(name)]), 'D360_NOT_FOUND', [
        runtimeMessages.getMessage('error.D360_NOT_FOUND.1.actions.1'),
      ]);
    }
    if (entities.length > 1) {
      throw new SfError(
        runtimeMessages.getMessage('error.D360_NAME_AMBIGUOUS.2', [String(name)]),
        'D360_NAME_AMBIGUOUS',
        [runtimeMessages.getMessage('error.D360_NAME_AMBIGUOUS.2.actions.1')]
      );
    }
    return entities[0];
  }

  private continuation(response: ListResponse, initialEndpoint: string): string | undefined {
    if (response.nextPageUrl) return response.nextPageUrl;
    const current = response.currentPageUrl ?? initialEndpoint;
    const url = new URL(current, 'https://data360.invalid');
    if (response.nextBatchId) {
      url.searchParams.set('nextBatchId', response.nextBatchId);
    } else if (response.offset !== undefined && (response.metadata?.length ?? 0) > 0) {
      url.searchParams.set('offset', String(response.offset + (response.metadata?.length ?? 0)));
    } else {
      return undefined;
    }
    return `${url.pathname}${url.search}`;
  }
}
