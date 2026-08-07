import { loadCommandMessages } from '../messages.js';
import { SfError } from '@salesforce/core';
import { SsotClient } from '../client/ssotClient.js';
import { resolveResourceKey } from '../shared/nameResolver.js';
import { redactSecrets } from '../shared/redact.js';
import { listAllSsot } from '../shared/listAll.js';

const runtimeMessages = loadCommandMessages('data360.runtime.connection.client');

export type ConnectionRecord = Record<string, unknown> & {
  id?: string;
  name?: string;
  label?: string;
  connectorType?: string;
  type?: string;
};

const records = (value: unknown, key: string): ConnectionRecord[] => {
  if (Array.isArray(value)) return value as ConnectionRecord[];
  if (typeof value !== 'object' || value === null) return [];
  const selected = (value as Record<string, unknown>)[key];
  return Array.isArray(selected) ? (selected as ConnectionRecord[]) : [];
};

export class ConnectionClient {
  public constructor(private readonly client: SsotClient) {}

  public async list(connectorType?: string): Promise<ConnectionRecord[]> {
    const types = connectorType ? [connectorType] : await this.connectorTypes();
    const result: ConnectionRecord[] = [];
    for (const type of types) {
      const page = await listAllSsot(this.client, {
        endpoint: '/connections',
        arrayKey: 'connections',
        query: { connectorType: type },
      });
      result.push(...(redactSecrets(page) as ConnectionRecord[]));
    }
    return [
      ...new Map(
        result.map((record, index) => [
          String(record.id ?? record.name ?? `${record.connectorType ?? 'connection'}-${index}`),
          record,
        ])
      ).values(),
    ];
  }

  public async resolve(name: string): Promise<string> {
    return resolveResourceKey(name, {
      idKind: 'id',
      nameFields: ['name', 'label'],
      list: async () => this.list(),
    });
  }

  public async get(name: string): Promise<ConnectionRecord> {
    const id = await this.resolve(name);
    return redactSecrets(
      await this.client.request<ConnectionRecord>({ method: 'GET', endpoint: `/connections/${encodeURIComponent(id)}` })
    ) as ConnectionRecord;
  }

  public async create(body: Record<string, unknown>): Promise<ConnectionRecord> {
    return redactSecrets(
      await this.client.request<ConnectionRecord>({ method: 'POST', endpoint: '/connections', body })
    ) as ConnectionRecord;
  }

  public async update(
    name: string,
    body: Record<string, unknown>,
    schema?: Record<string, unknown>
  ): Promise<ConnectionRecord> {
    const existing = await this.get(name);
    if (!/marketing.?cloud/iu.test(String(existing.connectorType ?? ''))) {
      throw new SfError(runtimeMessages.getMessage('error.D360_UNSUPPORTED_OP.0'), 'D360_UNSUPPORTED_OP', [
        runtimeMessages.getMessage('error.D360_UNSUPPORTED_OP.0.actions.1'),
      ]);
    }
    const id = String(existing.id ?? (await this.resolve(name)));
    const updated = await this.client.request<ConnectionRecord>({
      method: 'PATCH',
      endpoint: `/connections/${encodeURIComponent(id)}`,
      body,
    });
    if (schema) {
      await this.client.request({
        method: 'PUT',
        endpoint: `/connections/${encodeURIComponent(id)}/schema`,
        body: schema,
      });
    }
    return redactSecrets(updated) as ConnectionRecord;
  }

  public async delete(name: string): Promise<string> {
    const id = await this.resolve(name);
    await this.client.request({ method: 'DELETE', endpoint: `/connections/${encodeURIComponent(id)}` });
    return id;
  }

  public async validateExisting(name: string): Promise<Record<string, unknown>> {
    const id = await this.resolve(name);
    return redactSecrets(
      await this.client.request({
        method: 'POST',
        endpoint: `/connections/${encodeURIComponent(id)}/actions/test`,
      })
    ) as Record<string, unknown>;
  }

  public async validateCandidate(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return redactSecrets(
      await this.client.request({ method: 'POST', endpoint: '/connections/actions/test', body })
    ) as Record<string, unknown>;
  }

  public describe(
    name: string,
    section: string,
    object?: string
  ): Promise<Record<string, unknown> | Record<string, unknown>[]> {
    return this.resolve(name).then((id) => {
      const suffix =
        section === 'fields' || section === 'preview'
          ? `/objects/${encodeURIComponent(object ?? '')}/${section}`
          : `/${section === 'schemas' ? 'database-schemas' : section}`;
      return this.client
        .request({
          method: section === 'sitemap' ? 'GET' : 'POST',
          endpoint: `/connections/${encodeURIComponent(id)}${suffix}`,
          timeoutMs: 30_000,
        })
        .then((response) => redactSecrets(response) as Record<string, unknown> | Array<Record<string, unknown>>);
    });
  }

  private async connectorTypes(): Promise<string[]> {
    const response = await this.client.request<unknown>({ method: 'GET', endpoint: '/connectors' });
    const discovered = records(response, 'connectors')
      .map(({ name, type }) => name ?? type)
      .filter((type): type is string => typeof type === 'string');
    return discovered.includes('IngestApi') ? discovered : [...discovered, 'IngestApi'];
  }
}
