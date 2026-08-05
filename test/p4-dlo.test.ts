import { expect } from 'chai';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import DloCreate from '../src/commands/data360/dlo/create.js';
import DloDelete from '../src/commands/data360/dlo/delete.js';
import DloGet from '../src/commands/data360/dlo/get.js';
import DloList from '../src/commands/data360/dlo/list.js';
import DloUpdate from '../src/commands/data360/dlo/update.js';
import { registry } from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P4 DLO family', () => {
  const commandTest = createCommandTestContext();

  it('registers verified CRUD with fixture-backed columns and ID/name keys', () => {
    const resource = registry.get('dlo');
    expect(resource.operations).to.deep.equal(['list', 'get', 'create', 'update', 'delete']);
    expect(resource.idKind).to.deep.include({ get: 'idOrApiName', update: 'idOrApiName', delete: 'idOrApiName' });
    expect(resource.columns).to.deep.equal(['name', 'label', 'category', 'storageType']);
  });

  it('runs all verified CRUD leaves with definition input and exact paths', async () => {
    const org = new MockTestOrgData('p4-dlo');
    await commandTest.context.stubAuths(org);
    const requests: Array<{ method?: string; url?: string; body?: string }> = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string; body?: string };
      requests.push(value);
      if (value.method === 'DELETE') return undefined as never;
      if (value.method === 'POST' || value.method === 'PATCH') return JSON.parse(value.body ?? '{}') as never;
      if (value.url?.includes('/data-lake-objects/Orders__dll')) {
        return { name: 'Orders__dll', label: 'Orders', category: 'Engagement', storageType: 'Internal' } as never;
      }
      return {
        dataLakeObjects: [{ name: 'Orders__dll', label: 'Orders', category: 'Engagement', storageType: 'Internal' }],
      } as never;
    };
    const directory = await mkdtemp(join(tmpdir(), 'dlo-'));
    const definition = join(directory, 'dlo.json');
    await writeFile(definition, '{"name":"Orders__dll","label":"Orders"}');

    expect(((await DloList.run(['-o', org.username, '--json'])) as { items: unknown[] }).items).to.have.length(1);
    expect(await DloGet.run(['-o', org.username, '-n', 'orders', '--json'])).to.have.property('item');
    expect(await DloCreate.run(['-o', org.username, '-f', definition, '--json'])).to.have.property('item');
    expect(await DloUpdate.run(['-o', org.username, '-n', 'Orders__dll', '-f', definition, '--json'])).to.have.property(
      'item'
    );
    expect(await DloDelete.run(['-o', org.username, '-n', 'Orders__dll', '--no-prompt', '--json'])).to.deep.equal({
      deleted: true,
      key: 'Orders__dll',
    });
    expect(requests.some(({ method, url }) => method === 'PATCH' && url?.endsWith('/Orders__dll'))).to.equal(true);
  });

  it('follows a server nextPageUrl without overriding its embedded offset after an empty page', async () => {
    const org = new MockTestOrgData('p4-dlo-sparse-page');
    await commandTest.context.stubAuths(org);
    const urls: string[] = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const url = String((request as { url?: string }).url);
      if (!url.includes('/data-lake-objects')) return {} as never;
      urls.push(url);
      if (urls.length === 1) {
        return {
          dataLakeObjects: [],
          totalSize: 16,
          nextPageUrl: '/services/data/v42.0/ssot/data-lake-objects?limit=1&offset=1',
        } as never;
      }
      return {
        dataLakeObjects: [{ name: 'Orders__dll', label: 'Orders' }],
        totalSize: 16,
      } as never;
    };

    const result = (await DloList.run(['-o', org.username, '--limit', '1', '--json'])) as { items: unknown[] };
    expect(result.items).to.have.length(1);
    expect(urls).to.have.length(2);
    expect(urls[1], JSON.stringify(urls)).to.include('offset=1').and.not.to.include('offset=0');
  });
});
