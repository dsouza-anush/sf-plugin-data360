import { SsotClient } from '../client/ssotClient.js';

export type DataKitRecord = Record<string, unknown>;
export type DataKitAsyncResult = { item: DataKitRecord; jobId?: string };

export const AVAILABLE_COMPONENT_TYPES = [
  'DataStreamBundle',
  'CalculatedInsight',
  'DataLakeObject',
  'DataTransform',
  'EngagementSignal',
  'PersonalizationObjective',
  'PersonalizationRecommender',
  'PersonalizationPoint',
  'PersonalizationSchema',
] as const;

export const DEPENDENCY_COMPONENT_TYPES = [
  'ActivationTarget',
  'CalculatedInsight',
  'DataAction',
  'DataActionTarget',
  'DataConnection',
  'DataGraph',
  'DataLakeObject',
  'DataSemanticSearch',
  'DataShare',
  'DataStreamBundle',
  'DataTransform',
  'IdentityResolution',
  'MarketSegment',
  'MarketSegmentActivation',
  'MlConfiguredModel',
  'MlPredictionJob',
  'MlRetriever',
  'SemanticModel',
] as const;

const asRecord = (value: unknown): DataKitRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as DataKitRecord) : {};

const collection = (value: unknown, key: string): DataKitRecord[] => {
  if (Array.isArray(value)) return value.map(asRecord);
  const items = asRecord(value)[key];
  return Array.isArray(items) ? items.map(asRecord) : [];
};

const encoded = (value: string): string => encodeURIComponent(value);

export class DataKitClient {
  public constructor(private readonly client: SsotClient) {}

  public async list(namespace?: string): Promise<DataKitRecord[]> {
    return collection(
      await this.client.request({ method: 'GET', endpoint: '/data-kits', query: { namespace } }),
      'dataKitDetails'
    );
  }

  public async available(options: {
    componentType: (typeof AVAILABLE_COMPONENT_TYPES)[number];
    dataKitDevName: string;
    limit: number;
    offset: number;
  }): Promise<DataKitRecord[]> {
    return collection(
      await this.client.request({
        method: 'GET',
        endpoint: '/data-kits/available-components',
        query: {
          componentType: options.componentType,
          dataKitDevName: options.dataKitDevName,
          limit: options.limit,
          offset: options.offset,
        },
      }),
      'components'
    );
  }

  public async manifest(dataKitDevName: string): Promise<DataKitRecord[]> {
    return collection(
      await this.client.request({
        method: 'GET',
        endpoint: `/datakit/${encoded(dataKitDevName)}/manifest`,
      }),
      'dataKitMembers'
    );
  }

  public async create(definition: DataKitRecord): Promise<DataKitRecord> {
    return asRecord(await this.client.request({ method: 'POST', endpoint: '/data-kits', body: definition }));
  }

  public async update(dataKitDevName: string, definition: DataKitRecord): Promise<DataKitRecord> {
    return asRecord(
      await this.client.request({
        method: 'PATCH',
        endpoint: `/data-kits/${encoded(dataKitDevName)}`,
        body: definition,
      })
    );
  }

  public async delete(dataKitDevName: string): Promise<void> {
    await this.client.request({ method: 'DELETE', endpoint: `/data-kits/${encoded(dataKitDevName)}` });
  }

  public async deploy(dataKitDevName: string, definition: DataKitRecord, dataspace?: string): Promise<DataKitRecord> {
    return asRecord(
      await this.client.request({
        method: 'POST',
        endpoint: `/data-kits/${encoded(dataKitDevName)}`,
        query: { asyncMode: true, dataspace },
        body: definition,
      })
    );
  }

  public async undeploy(dataKitDevName: string, definition: DataKitRecord, dataspace?: string): Promise<DataKitRecord> {
    return asRecord(
      await this.client.request({
        method: 'POST',
        endpoint: `/data-kits/${encoded(dataKitDevName)}/undeploy`,
        query: { asyncMode: true, dataspace },
        body: definition,
      })
    );
  }

  public async dependencies(options: {
    dataKitName: string;
    componentName: string;
    componentType: (typeof DEPENDENCY_COMPONENT_TYPES)[number];
    dataspace?: string;
  }): Promise<DataKitRecord[]> {
    return collection(
      await this.client.request({
        method: 'GET',
        endpoint: `/data-kits/${encoded(options.dataKitName)}/components/${encoded(options.componentName)}/dependencies`,
        query: { componentType: options.componentType, dataspace: options.dataspace },
      }),
      'componentDependencies'
    );
  }

  public async status(dataKitName: string, componentName: string): Promise<DataKitRecord> {
    return asRecord(
      await this.client.request({
        method: 'GET',
        endpoint: `/data-kits/${encoded(dataKitName)}/components/${encoded(componentName)}/deployment-status`,
      })
    );
  }
}
