import { expect } from 'chai';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import DmoCreate from '../src/commands/data360/dmo/create.js';
import DmoDelete from '../src/commands/data360/dmo/delete.js';
import DmoGet from '../src/commands/data360/dmo/get.js';
import DmoList from '../src/commands/data360/dmo/list.js';
import DmoRelationshipCreate from '../src/commands/data360/dmo/relationship/create.js';
import DmoRelationshipDelete from '../src/commands/data360/dmo/relationship/delete.js';
import DmoRelationshipList from '../src/commands/data360/dmo/relationship/list.js';
import DmoUpdate from '../src/commands/data360/dmo/update.js';
import type { SsotClient } from '../src/client/ssotClient.js';
import { DmoClient } from '../src/dmo/client.js';
import { registry } from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P4 DMO family', () => {
  const commandTest = createCommandTestContext();

  it('registers verified CRUD and distinct relationship paths', () => {
    const resource = registry.get('dmo');
    expect(resource.operations).to.deep.equal(['list', 'get', 'create', 'update', 'delete']);
    expect(resource.columns).to.deep.equal(['name', 'label', 'category', 'mappedDlos#']);
    expect(resource.actions?.relationshipList).to.deep.include({
      method: 'GET',
      path: '/data-model-objects/{key}/relationships',
    });
    expect(resource.actions?.relationshipDelete).to.deep.include({
      method: 'DELETE',
      path: '/data-model-objects/relationships/{relationship}',
    });
  });

  it('normalizes incomplete DLO fields when creating a DMO definition', async () => {
    let created: Record<string, unknown> | undefined;
    const client = new DmoClient({
      request: async ({ method, body }: { method: string; body?: Record<string, unknown> }) => {
        if (method === 'GET') {
          return {
            fields: [{ isPrimaryKey: false }, { name: 'Id__c', type: 'BIGINT', isPrimaryKey: true }],
          };
        }
        created = body;
        return body;
      },
    } as unknown as SsotClient);

    expect(await client.createFromDlo('Fallback__dll')).to.deep.equal(created);
    expect(created).to.deep.include({ name: 'Fallback', label: 'Fallback', category: 'OTHER' });
    expect(created?.fields).to.deep.equal([
      { name: 'field_0', label: 'Field 1', dataType: 'Text', isPrimaryKey: false },
      { name: 'Id__c', label: 'Id__c', dataType: 'Number', isPrimaryKey: true },
    ]);
  });

  it('treats a legitimate 204 relationship response as an empty list', async () => {
    const requests: Array<{ method?: string; endpoint?: string }> = [];
    const client = new DmoClient({
      request: async (request: { method?: string; endpoint?: string }) => {
        requests.push(request);
        return undefined;
      },
    } as unknown as SsotClient);

    expect(await client.listRelationships('Disposable__dlm', { all: true, limit: 200 })).to.deep.equal([]);
    expect(requests).to.deep.equal([
      {
        method: 'GET',
        endpoint: '/data-model-objects/Disposable__dlm/relationships',
        query: { offset: 0, limit: 200 },
      },
    ]);
  });

  it('encodes every relationship CSV cell and neutralizes spreadsheet formulas', async () => {
    const org = new MockTestOrgData('p4-dmo-relationship-csv');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (): Promise<never> =>
      ({
        relationships: [
          {
            name: '=FORMULA',
            label: 'label,with,commas',
            type: 'Lookup\nInjected',
            status: 'Active',
          },
        ],
      }) as never;
    const stdout = commandTest.context.SANDBOX.stub(process.stdout, 'write').returns(true);

    await DmoRelationshipList.run(['-o', org.username, '-n', 'Target__dlm', '--result-format', 'csv']);

    expect(String(stdout.firstCall.args[0])).to.equal(
      'name,label,type,status\r\n\'=FORMULA,"label,with,commas","Lookup\nInjected",Active\r\n'
    );
  });

  it('runs CRUD, from-DLO creation, and exact relationship collection/delete paths', async () => {
    const org = new MockTestOrgData('p4-dmo');
    await commandTest.context.stubAuths(org);
    const requests: Array<{ method?: string; url?: string; body?: string }> = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string; body?: string };
      requests.push(value);
      if (value.method === 'DELETE') return undefined as never;
      if (value.url?.includes('/data-lake-objects/Orders__dll')) {
        return {
          name: 'Orders__dll',
          label: 'Orders',
          category: 'Engagement',
          fields: [{ name: 'Id__c', label: 'Id', dataType: 'VARCHAR', isPrimaryKey: true }],
        } as never;
      }
      if (value.url?.includes('/relationships') && value.method === 'GET') {
        return {
          relationships: [{ name: 'OrderContact', label: 'Order Contact', type: 'Lookup', status: 'Active' }],
        } as never;
      }
      if (value.method === 'POST' || value.method === 'PATCH') return JSON.parse(value.body ?? '{}') as never;
      if (/\/data-model-objects\/[^?]+$/u.test(value.url ?? '')) {
        return { name: 'Order', label: 'Order', category: 'Engagement', mappedDlos: ['Orders__dll'] } as never;
      }
      return {
        dataModelObjects: [{ name: 'Order', label: 'Order', category: 'Engagement', mappedDlos: ['Orders__dll'] }],
      } as never;
    };
    const directory = await mkdtemp(join(tmpdir(), 'dmo-'));
    const definition = join(directory, 'dmo.json');
    const relationship = join(directory, 'relationship.json');
    await writeFile(definition, '{"name":"Order","label":"Order"}');
    await writeFile(relationship, '{"name":"OrderContact","targetObject":"Contact"}');

    const listed = (await DmoList.run(['-o', org.username, '--json'])) as {
      items: Array<Record<string, unknown>>;
    };
    expect(listed.items).to.have.length(1);
    expect(listed.items[0]['mappedDlos#']).to.equal(1);
    expect(await DmoGet.run(['-o', org.username, '-n', 'Order', '--json'])).to.have.property('item');
    expect(await DmoCreate.run(['-o', org.username, '-f', definition, '--json'])).to.have.property('item');
    const fromDlo = (await DmoCreate.run(['-o', org.username, '--from-dlo', 'Orders__dll', '--json'])) as {
      item: Record<string, unknown>;
    };
    expect(fromDlo.item).to.deep.include({ name: 'Orders', sourceDataLakeObjectName: 'Orders__dll' });
    expect(await DmoUpdate.run(['-o', org.username, '-n', 'Order', '-f', definition, '--json'])).to.have.property(
      'item'
    );
    expect((await DmoRelationshipList.run(['-o', org.username, '-n', 'Order', '--json'])).items).to.have.length(1);
    expect(
      await DmoRelationshipCreate.run(['-o', org.username, '-n', 'Order', '-f', relationship, '--json'])
    ).to.have.property('item');
    await DmoRelationshipDelete.run([
      '-o',
      org.username,
      '--relationship-name',
      'OrderContact',
      '--no-prompt',
      '--json',
    ]);
    await DmoDelete.run(['-o', org.username, '-n', 'Order', '--no-prompt', '--json']);

    expect(
      requests.some(({ method, url }) => method === 'POST' && url?.endsWith('/data-model-objects/Order/relationships'))
    ).to.equal(true);
    expect(
      requests.some(
        ({ method, url }) => method === 'DELETE' && url?.endsWith('/data-model-objects/relationships/OrderContact')
      )
    ).to.equal(true);
  });
});
