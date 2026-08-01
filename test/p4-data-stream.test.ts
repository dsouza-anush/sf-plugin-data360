import { expect } from 'chai';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import DataStreamCreate from '../src/commands/data360/data-stream/create.js';
import DataStreamDelete from '../src/commands/data360/data-stream/delete.js';
import DataStreamGet from '../src/commands/data360/data-stream/get.js';
import DataStreamList from '../src/commands/data360/data-stream/list.js';
import DataStreamRun from '../src/commands/data360/data-stream/run.js';
import DataStreamUpdate from '../src/commands/data360/data-stream/update.js';
import { registry } from '../src/resources/registry.js';
import { assertRejects } from './helpers/async.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P4 data-stream family', () => {
  const commandTest = createCommandTestContext();

  it('registers verified CRUD, run, and safe delete query contract', () => {
    const resource = registry.get('data-stream');
    expect(resource.operations).to.deep.equal(['list', 'get', 'create', 'update', 'delete']);
    expect(resource.actions?.run).to.deep.include({
      method: 'POST',
      path: '/data-streams/{key}/actions/run',
      timeoutMs: 120_000,
    });
    expect(resource.columns).to.deep.equal([
      'name',
      'label',
      'connectorType',
      'refreshMode',
      'lastRunStatus',
      'lastRunTime',
    ]);
  });

  it('runs CRUD/run and enforces CRM and safe delete behavior', async () => {
    const org = new MockTestOrgData('p4-stream');
    await commandTest.context.stubAuths(org);
    const requests: Array<{ method?: string; url?: string; body?: string }> = [];
    let crm = false;
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string; body?: string };
      requests.push(value);
      if (value.method === 'DELETE') return undefined as never;
      if (value.method === 'POST' || value.method === 'PATCH') return JSON.parse(value.body ?? '{}') as never;
      if (/\/data-streams\/[^?]+$/u.test(value.url ?? '')) {
        return {
          name: 'OrdersStream',
          connectorType: crm ? 'CRM' : 'S3',
          externalSource: !crm,
        } as never;
      }
      return { dataStreams: [{ name: 'OrdersStream', connectorType: 'S3', externalSource: true }] } as never;
    };
    const directory = await mkdtemp(join(tmpdir(), 'stream-'));
    const definition = join(directory, 'stream.json');
    await writeFile(definition, '{"name":"OrdersStream","connectorType":"S3"}');
    expect(((await DataStreamList.run(['-o', org.username, '--json'])) as { items: unknown[] }).items).to.have.length(
      1
    );
    await DataStreamGet.run(['-o', org.username, '-n', 'OrdersStream', '--json']);
    await DataStreamCreate.run(['-o', org.username, '-f', definition, '--json']);
    await DataStreamUpdate.run(['-o', org.username, '-n', 'OrdersStream', '-f', definition, '--json']);
    const beforeRun = requests.length;
    await DataStreamRun.run(['-o', org.username, '-n', 'OrdersStream', '--no-prompt', '--json']);
    const runRequests = requests.slice(beforeRun).filter(({ url }) => url?.includes('/ssot/'));
    expect(runRequests.map(({ method }) => method)).to.deep.equal(['GET', 'GET', 'POST']);
    expect(runRequests[0].url?.split('?')[0]).to.match(/\/ssot\/data-streams$/u);
    expect(runRequests[1].url?.split('?')[0]).to.match(/\/ssot\/data-streams\/OrdersStream$/u);
    expect(runRequests[2].url?.split('?')[0]).to.match(/\/ssot\/data-streams\/OrdersStream\/actions\/run$/u);
    crm = true;
    const unsupported = await assertRejects(DataStreamRun.run(['-o', org.username, '-n', 'OrdersStream', '--json']));
    expect(unsupported.name).to.equal('D360_UNSUPPORTED_OP');

    const beforeDeletes = requests.filter(({ method }) => method === 'DELETE').length;
    const confirmation = await assertRejects(
      DataStreamDelete.run(['-o', org.username, '-n', 'OrdersStream', '--json'])
    );
    expect(confirmation.name).to.equal('D360_CONFIRMATION_REQUIRED');
    expect(requests.filter(({ method }) => method === 'DELETE')).to.have.length(beforeDeletes);
    await DataStreamDelete.run(['-o', org.username, '-n', 'OrdersStream', '--no-prompt', '--json']);
    expect(requests.at(-1)?.url).to.include('shouldDeleteDataLakeObject=false');

    const confirms = commandTest.context.SANDBOX.stub(
      DataStreamDelete.prototype as unknown as { confirmDestructive: () => Promise<void> },
      'confirmDestructive'
    ).resolves();
    await DataStreamDelete.run(['-o', org.username, '-n', 'OrdersStream', '--delete-dlo', '--json']);
    expect(confirms.callCount).to.equal(2);
    expect(requests.at(-1)?.url).to.include('shouldDeleteDataLakeObject=true');
  }).timeout(30_000);
});
