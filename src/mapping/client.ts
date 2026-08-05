import { loadCommandMessages } from '../messages.js';
import { SsotClient } from '../client/ssotClient.js';
import { SfError } from '@salesforce/core';
import { matchFields, type Field, type MatchResult } from './matcher.js';
import { listAllSsot } from '../shared/listAll.js';
import { resolveResourceKey } from '../shared/nameResolver.js';

const runtimeMessages = loadCommandMessages('data360.runtime.mapping.client');

type Item = Record<string, unknown>;

const unwrapFirst = (value: Item, arrayKey: string): Item => {
  const items = value[arrayKey];
  return Array.isArray(items) && items.length > 0 && typeof items[0] === 'object' && items[0] !== null
    ? (items[0] as Item)
    : value;
};

export class MappingClient {
  public constructor(private readonly client: SsotClient) {}

  public async list(filters: { dmo?: string; sourceObject?: string; limit?: number }): Promise<Item[]> {
    return listAllSsot(this.client, {
      endpoint: '/data-model-object-mappings',
      arrayKey: 'objectSourceTargetMaps',
      query: { dmoDeveloperName: filters.dmo, dloDeveloperName: filters.sourceObject },
      limit: filters.limit,
    });
  }

  public get(name: string): Promise<Item> {
    return this.client.request({ method: 'GET', endpoint: `/data-model-object-mappings/${encodeURIComponent(name)}` });
  }

  public async resolve(filters: { dmo: string; sourceObject?: string }): Promise<Item> {
    const selector = filters.sourceObject ?? filters.dmo;
    const key = await resolveResourceKey(selector, {
      idKind: 'apiName',
      apiNameField: 'developerName',
      nameFields: ['developerName', 'sourceEntityDeveloperName', 'targetEntityDeveloperName'],
      list: async () => this.list(filters),
    });
    return this.get(key);
  }

  public create(body: Item): Promise<Item> {
    return this.client.request({ method: 'POST', endpoint: '/data-model-object-mappings', body });
  }

  public async auto(
    dlo: string,
    dmo: string,
    dryRun: boolean
  ): Promise<MatchResult & { created: boolean; item?: Item }> {
    const [sourceResponse, targetResponse] = await Promise.all([
      this.client.request<Item>({ method: 'GET', endpoint: `/data-lake-objects/${encodeURIComponent(dlo)}` }),
      this.client.request<Item>({ method: 'GET', endpoint: `/data-model-objects/${encodeURIComponent(dmo)}` }),
    ]);
    const source = unwrapFirst(sourceResponse, 'dataLakeObjects');
    const target = unwrapFirst(targetResponse, 'dataModelObjects');
    const fields = (value: unknown): Field[] =>
      Array.isArray(value)
        ? value
            .filter((field): field is Item => typeof field === 'object' && field !== null)
            .map((field) => ({ name: String(field.name ?? '') }))
            .filter(({ name }) => name.length > 0)
        : [];
    const result = matchFields(fields(source.fields), fields(target.fields));
    if (!dryRun && (result.mappings.length === 0 || result.ambiguous.length > 0)) {
      throw new SfError(runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.0'), 'D360_INVALID_DEFINITION', [
        runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.0.actions.1'),
      ]);
    }
    const item = dryRun
      ? undefined
      : await this.create({
          sourceEntityDeveloperName: dlo,
          targetEntityDeveloperName: dmo,
          fieldMapping: result.mappings.map(({ sourceFieldDeveloperName, targetFieldDeveloperName }) => ({
            sourceFieldDeveloperName,
            targetFieldDeveloperName,
          })),
        });
    return { ...result, created: !dryRun, ...(item ? { item } : {}) };
  }

  public async update(
    name: string,
    definitions: Item[]
  ): Promise<Array<{ field: string; success: boolean; reason?: string }>> {
    const mapping = await this.get(name);
    const outcomes: Array<{ field: string; success: boolean; reason?: string }> = [];
    for (const definition of definitions) {
      const field = String(definition.name ?? definition.fieldMappingName ?? '');
      const fieldMapping = { ...definition };
      delete fieldMapping.name;
      delete fieldMapping.fieldMappingName;
      const body = {
        sourceEntityDeveloperName: mapping.sourceEntityDeveloperName,
        targetEntityDeveloperName: mapping.targetEntityDeveloperName,
        fieldMapping: [fieldMapping],
      };
      try {
        await this.client.request({
          method: 'PATCH',
          endpoint: `/data-model-object-mappings/${encodeURIComponent(name)}/field-mappings/${encodeURIComponent(field)}`,
          body,
        });
        outcomes.push({ field, success: true });
      } catch (error) {
        outcomes.push({ field, success: false, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return outcomes;
  }

  public async delete(name: string, fields?: string[]): Promise<void> {
    if (fields) {
      for (const field of fields) {
        await this.client.request({
          method: 'DELETE',
          endpoint: `/data-model-object-mappings/${encodeURIComponent(name)}/field-mappings/${encodeURIComponent(field)}`,
        });
      }
    } else {
      await this.client.request({
        method: 'DELETE',
        endpoint: `/data-model-object-mappings/${encodeURIComponent(name)}`,
      });
    }
  }
}
