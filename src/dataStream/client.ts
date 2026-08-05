import { loadCommandMessages } from '../messages.js';
import { SfError } from '@salesforce/core';
import { SsotClient } from '../client/ssotClient.js';
import { resolveResourceKey } from '../shared/nameResolver.js';
import { listAllSsot } from '../shared/listAll.js';

const runtimeMessages = loadCommandMessages('data360.runtime.dataStream.client');

type Item = Record<string, unknown>;
export type ResolvedDataStream = { key: string; item: Item };
export class DataStreamClient {
  public constructor(private readonly client: SsotClient) {}
  private async resolve(name: string): Promise<string> {
    return resolveResourceKey(name, {
      idKind: 'idOrApiName',
      apiNameField: 'name',
      nameFields: ['name', 'label'],
      list: async () => listAllSsot(this.client, { endpoint: '/data-streams', arrayKey: 'dataStreams' }),
    });
  }
  public async inspect(name: string): Promise<ResolvedDataStream> {
    const key = await this.resolve(name);
    const item = await this.client.request<Item>({
      method: 'GET',
      endpoint: `/data-streams/${encodeURIComponent(key)}`,
    });
    return { key, item };
  }
  public async get(name: string): Promise<Item> {
    return (await this.inspect(name)).item;
  }
  public async run(name: string): Promise<Item> {
    return this.runResolved(await this.inspect(name));
  }
  public async runResolved({ key, item }: ResolvedDataStream): Promise<Item> {
    if (/crm/iu.test(String(item.connectorType ?? ''))) {
      throw new SfError(runtimeMessages.getMessage('error.D360_UNSUPPORTED_OP.0'), 'D360_UNSUPPORTED_OP', [
        runtimeMessages.getMessage('error.D360_UNSUPPORTED_OP.0.actions.1'),
      ]);
    }
    return this.client.request({
      method: 'POST',
      endpoint: `/data-streams/${encodeURIComponent(key)}/actions/run`,
      timeoutMs: 120_000,
      errorContext: {
        actionTimeout: {
          label: 'data stream run',
          recoveryCommand: 'Run sf data360 data-stream get --name <name> --target-org <alias> before retrying.',
        },
      },
    });
  }
  public async delete(name: string, deleteDlo: boolean): Promise<void> {
    const key = await this.resolve(name);
    await this.client.request({
      method: 'DELETE',
      endpoint: `/data-streams/${encodeURIComponent(key)}`,
      query: { shouldDeleteDataLakeObject: deleteDlo },
    });
  }
}
