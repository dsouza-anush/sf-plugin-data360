import { loadCommandMessages } from '../messages.js';
import { SsotClient } from '../client/ssotClient.js';
import { SfError } from '@salesforce/core';
import { resolveResourceKey } from '../shared/nameResolver.js';
import { listAllSsot } from '../shared/listAll.js';

const runtimeMessages = loadCommandMessages('data360.runtime.dmo.client');

type Item = Record<string, unknown>;

const typeMap: Record<string, string> = {
  VARCHAR: 'Text',
  DECIMAL: 'Number',
  BIGINT: 'Number',
  INTEGER: 'Number',
  DOUBLE: 'Number',
  FLOAT: 'Number',
  BOOLEAN: 'Boolean',
  TIMESTAMP: 'DateTime',
  DATE: 'DateTime',
};

export class DmoClient {
  private async resolve(name: string): Promise<string> {
    if (/__dlm$/u.test(name)) return name;
    return resolveResourceKey(name, {
      idKind: 'idOrApiName',
      apiNameField: 'name',
      nameFields: ['name', 'label'],
      list: async () =>
        listAllSsot(this.client, {
          endpoint: '/data-model-objects',
          arrayKey: ['dataModelObjects', 'dataModelObject'],
        }),
    });
  }
  public constructor(private readonly client: SsotClient) {}

  public create(body: Item): Promise<Item> {
    return this.client.request({ method: 'POST', endpoint: '/data-model-objects', body });
  }

  public async createFromDlo(dloName: string): Promise<Item> {
    const dlo = await this.client.request<Item>({
      method: 'GET',
      endpoint: `/data-lake-objects/${encodeURIComponent(dloName)}`,
    });
    const fields = Array.isArray(dlo.fields)
      ? (dlo.fields as Item[]).map((field, index) => ({
          name: String(field.name ?? `field_${index}`),
          label: String(field.label ?? field.name ?? `Field ${index + 1}`),
          dataType: typeMap[String(field.dataType ?? field.type ?? 'VARCHAR').toUpperCase()] ?? 'Text',
          isPrimaryKey: field.isPrimaryKey === true,
        }))
      : [];
    if (!fields.some(({ isPrimaryKey }) => isPrimaryKey)) {
      throw new SfError(runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.0'), 'D360_INVALID_DEFINITION', [
        runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.0.actions.1'),
      ]);
    }
    const name = dloName.replace(/__dll$/u, '');
    return this.create({
      name,
      label: String(dlo.label ?? name),
      category: String(dlo.category ?? 'OTHER').toUpperCase(),
      fields,
      sourceDataLakeObjectName: dloName,
    });
  }

  public async listRelationships(dmoName: string, options: { all: boolean; limit: number }): Promise<Item[]> {
    const key = await this.resolve(dmoName);
    const result: Item[] = [];
    let offset = 0;
    let shouldContinue = true;
    while (shouldContinue) {
      const response = await this.client.request<Item | undefined>({
        method: 'GET',
        endpoint: `/data-model-objects/${encodeURIComponent(key)}/relationships`,
        query: { offset, limit: Math.min(options.limit, 200) },
      });
      const page = Array.isArray(response?.relationships) ? (response.relationships as Item[]) : [];
      result.push(...page);
      offset += page.length;
      shouldContinue =
        options.all && page.length > 0 && typeof response?.totalSize === 'number' && offset < response.totalSize;
    }
    return options.all ? result : result.slice(0, options.limit);
  }

  public async createRelationship(dmoName: string, body: Item): Promise<Item> {
    const key = await this.resolve(dmoName);
    return this.client.request({
      method: 'POST',
      endpoint: `/data-model-objects/${encodeURIComponent(key)}/relationships`,
      body,
    });
  }

  public async deleteRelationship(relationshipName: string): Promise<void> {
    await this.client.request({
      method: 'DELETE',
      endpoint: `/data-model-objects/relationships/${encodeURIComponent(relationshipName)}`,
    });
  }
}
