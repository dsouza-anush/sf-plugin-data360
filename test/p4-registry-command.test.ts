import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import { defineResource } from '../src/resources/defineResource.js';
import * as registryModule from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';

describe('generic registry commands', () => {
  const commandTest = createCommandTestContext();

  it('parses concrete CRUD flags, injects transport, paginates, resolves names, and renders output', async () => {
    const createRegistryCommand = (
      registryModule as unknown as {
        createRegistryCommand?: (options: Record<string, unknown>) => {
          run: (argv: string[]) => Promise<unknown>;
        };
      }
    ).createRegistryCommand;
    expect(createRegistryCommand).to.be.a('function');

    const resource = defineResource({
      topic: 'widget',
      base: '/widgets',
      nameFields: ['name', 'label'],
      columns: ['name', 'label', 'status'],
      operations: ['list', 'get', 'create', 'update', 'delete'],
      idKind: { get: 'id', update: 'id', delete: 'id' },
      destructive: { delete: true },
      pagination: { dialect: 'offset', arrayKey: 'widgets' },
    });
    const List = createRegistryCommand!({ resource, operation: 'list', summary: 'List widgets.' });
    const Get = createRegistryCommand!({ resource, operation: 'get', summary: 'Get a widget.' });
    const Create = createRegistryCommand!({ resource, operation: 'create', summary: 'Create a widget.' });
    const Delete = createRegistryCommand!({ resource, operation: 'delete', summary: 'Delete a widget.' });
    const org = new MockTestOrgData('registry-command');
    await commandTest.context.stubAuths(org);
    const requests: Array<{ method?: string; url?: string; body?: string }> = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string; body?: string };
      requests.push(value);
      if (value.method === 'DELETE') return undefined as never;
      if (value.method === 'POST') return JSON.parse(value.body ?? '{}') as never;
      if (value.url?.endsWith('/widgets/one'))
        return { id: 'one', name: 'Orders', label: 'Orders', status: 'Ready' } as never;
      const offset = new URL(`https://example.test${value.url}`).searchParams.get('offset');
      return {
        widgets:
          offset === '1'
            ? [{ id: 'two', name: 'Contacts', label: 'Contacts', status: 'Ready' }]
            : [{ id: 'one', name: 'Orders', label: 'Orders', status: 'Ready' }],
        totalSize: 2,
      } as never;
    };

    const listed = (await List.run(['-o', org.username, '--all', '--json'])) as { items: unknown[] };
    expect(listed.items).to.have.length(2);
    expect(commandTest.ux.table.called).to.equal(false);
    await List.run(['-o', org.username]);
    expect(commandTest.ux.table.calledWithMatch({ columns: resource.columns })).to.equal(true);
    const stdout = commandTest.context.SANDBOX.stub(process.stdout, 'write').returns(true);
    await List.run(['-o', org.username, '--limit', '1', '--result-format', 'json']);
    expect(JSON.parse(String(stdout.firstCall.args[0]))).to.deep.equal([
      { id: 'one', name: 'Orders', label: 'Orders', status: 'Ready' },
    ]);

    const got = (await Get.run(['-o', org.username, '-n', 'orders', '--json'])) as { item: Record<string, unknown> };
    expect(got.item).to.deep.include({ id: 'one', name: 'Orders' });
    const directory = await mkdtemp(join(tmpdir(), 'registry-'));
    const definition = join(directory, 'widget.json');
    await writeFile(definition, '{"name":"New"}');
    expect(await Create.run(['-o', org.username, '-f', definition, '--json'])).to.deep.equal({
      item: { name: 'New' },
    });
    expect(await Delete.run(['-o', org.username, '-n', 'Orders', '--no-prompt', '--json'])).to.deep.equal({
      deleted: true,
      key: 'Orders',
    });
    expect(requests.map(({ method }) => method)).to.include.members(['GET', 'POST', 'DELETE']);
  }).timeout(20_000);
});
