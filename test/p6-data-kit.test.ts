import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import Available from '../src/commands/data360/data-kit/available.js';
import ComponentDependencies from '../src/commands/data360/data-kit/component/dependencies.js';
import ComponentStatus from '../src/commands/data360/data-kit/component/status.js';
import Create from '../src/commands/data360/data-kit/create.js';
import Delete from '../src/commands/data360/data-kit/delete.js';
import Deploy from '../src/commands/data360/data-kit/deploy.js';
import List from '../src/commands/data360/data-kit/list.js';
import Manifest from '../src/commands/data360/data-kit/manifest.js';
import Undeploy from '../src/commands/data360/data-kit/undeploy.js';
import Update from '../src/commands/data360/data-kit/update.js';
import { componentRows, componentStatusRows, dataKitRows, manifestRows } from '../src/dataKit/command.js';
import { dataKitResource } from '../src/resources/dataKit.js';
import { registry } from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';
import { loadFixture } from './helpers/fixtures.js';

const fixtureFiles = [
  'list',
  'available',
  'manifest',
  'create',
  'update',
  'delete',
  'deploy',
  'undeploy',
  'dependencies',
  'status',
];

describe('P6 Data Kit family', () => {
  const commandTest = createCommandTestContext();

  it('registers only the current v67 OpenAPI operations and destructive boundaries', () => {
    expect(registry.get('data-kit')).to.equal(dataKitResource);
    expect(dataKitResource.operations).to.deep.equal(['list', 'create', 'update', 'delete']);
    expect(dataKitResource.operations).not.to.include('get');
    expect(dataKitResource.operationSpecs).to.deep.equal({
      list: { method: 'GET', path: '/data-kits' },
      create: { method: 'POST', path: '/data-kits' },
      update: { method: 'PATCH', path: '/data-kits/{key}' },
      delete: { method: 'DELETE', path: '/data-kits/{key}' },
    });
    expect(dataKitResource.actions).to.deep.equal({
      available: { method: 'GET', path: '/data-kits/available-components' },
      manifest: { method: 'GET', path: '/datakit/{key}/manifest' },
      deploy: { method: 'POST', path: '/data-kits/{key}', queryParams: { asyncMode: true } },
      undeploy: { method: 'POST', path: '/data-kits/{key}/undeploy', queryParams: { asyncMode: true } },
      dependencies: { method: 'GET', path: '/data-kits/{key}/components/{component}/dependencies' },
      status: { method: 'GET', path: '/data-kits/{key}/components/{component}/deployment-status' },
    });
    expect(dataKitResource.destructive).to.deep.equal({ update: true, delete: true, undeploy: true });
  });

  it('keeps official-contract mock fixtures synthetic and permits exact read verification', async () => {
    for (const name of fixtureFiles) {
      const fixture = JSON.parse(await readFile(`test/fixtures/data-kit/${name}.json`, 'utf8')) as {
        __fixture?: { reference?: string; source?: string };
        synthetic?: boolean;
      };
      expect(fixture.__fixture?.source, name).to.equal('synthetic');
      expect(fixture.synthetic, name).to.equal(true);
      expect(fixture.__fixture?.reference, name).to.include('v67 OpenAPI');
    }
    const verification = JSON.parse(await readFile('test/verification.json', 'utf8')) as Array<{
      command: string;
      live: string | null;
    }>;
    const rows = verification.filter(({ command }) => command.startsWith('data360 data-kit'));
    expect(rows).to.have.length(10);
    const liveReadCommands = new Set([
      'data360 data-kit available',
      'data360 data-kit component status',
      'data360 data-kit create',
      'data360 data-kit delete',
      'data360 data-kit list',
      'data360 data-kit manifest',
      'data360 data-kit undeploy',
      'data360 data-kit update',
    ]);
    const liveRows = rows.filter(({ command }) => liveReadCommands.has(command));
    expect(liveRows).to.have.length(8);
    expect(liveRows.every(({ live }) => live !== null)).to.equal(true);
    const undatedRows = rows.filter(({ command }) => !liveReadCommands.has(command));
    expect(undatedRows).to.have.length(2);
    expect(undatedRows.every(({ live }) => live === null)).to.equal(true);
  });

  it('normalizes official list, component, and manifest response shapes for human tables', () => {
    expect(dataKitRows([{ devName: 'Kit', components: [{}], publishingSequence: [{}, {}] }])[0]).to.deep.include({
      developerName: 'Kit',
      'components#': 1,
      'publishingSequence#': 2,
    });
    expect(
      componentRows([{ type: 'DataLakeObject', info: { name: 'Customer__dll', label: 'Customer' } }])[0]
    ).to.deep.equal({
      type: 'DataLakeObject',
      name: 'Customer__dll',
      label: 'Customer',
      connectorType: undefined,
    });
    expect(
      manifestRows([{ entityName: 'DataLakeObject', developerName: ['Customer__dll'], id: ['0gO1'] }])[0]
    ).to.deep.equal({ entityName: 'DataLakeObject', developerName: 'Customer__dll', id: '0gO1' });
    expect(
      componentStatusRows({
        componentDetails: [{ componentId: '0gO1', dataKitName: 'Kit', status: 'Active' }],
        status: { code: 'ACTIVE', message: 'The status of the component is ACTIVE' },
      })[0]
    ).to.deep.equal({
      componentId: '0gO1',
      dataKitName: 'Kit',
      status: 'Active',
      code: 'ACTIVE',
      message: 'The status of the component is ACTIVE',
    });
  });

  it('executes the exact v67 Data Kit surface through real parsers', async () => {
    const server = Fastify({ logger: false });
    const calls: Array<{ body: unknown; method: string; url: string }> = [];
    server.addHook('preHandler', async (request) =>
      calls.push({ body: request.body, method: request.method, url: request.url })
    );
    server.get('/services/data/v67.0/ssot/data-kits', async () => loadFixture('data-kit/list.json'));
    server.get('/services/data/v67.0/ssot/data-kits/available-components', async () =>
      loadFixture('data-kit/available.json')
    );
    server.get('/services/data/v67.0/ssot/datakit/:name/manifest', async () => loadFixture('data-kit/manifest.json'));
    server.post('/services/data/v67.0/ssot/data-kits', async () => loadFixture('data-kit/create.json'));
    server.patch('/services/data/v67.0/ssot/data-kits/:name', async () => loadFixture('data-kit/update.json'));
    server.delete('/services/data/v67.0/ssot/data-kits/:name', async (_request, reply) => reply.code(200).send());
    server.post('/services/data/v67.0/ssot/data-kits/:name', async () => loadFixture('data-kit/deploy.json'));
    server.post('/services/data/v67.0/ssot/data-kits/:name/undeploy', async () =>
      loadFixture('data-kit/undeploy.json')
    );
    server.get('/services/data/v67.0/ssot/data-kits/:name/components/:component/dependencies', async () =>
      loadFixture('data-kit/dependencies.json')
    );
    server.get('/services/data/v67.0/ssot/data-kits/:name/components/:component/deployment-status', async () =>
      loadFixture('data-kit/status.json')
    );
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p6-data-kit');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { body?: string; method?: string; url: string };
      const response = await fetch(`${base}${value.url}`, {
        method: value.method,
        body: value.body,
        headers: value.body ? { 'content-type': 'application/json' } : undefined,
      });
      const raw = await response.text();
      return (raw ? JSON.parse(raw) : undefined) as never;
    };
    const directory = await mkdtemp(join(tmpdir(), 'p6-data-kit-'));
    const definitions = {
      create: {
        dataKitDevName: 'CustomerFoundation',
        label: 'Customer Foundation',
        dataKitType: 'None',
        components: [{ type: 'DataLakeObject', info: { name: 'Customer__dll', label: 'Customer' } }],
      },
      update: { components: [{ type: 'DataLakeObject', info: { name: 'Customer__dll', label: 'Customer' } }] },
      deploy: {
        components: [
          {
            type: 'DataStreamBundle',
            config: {
              connectorType: 'COMMERCE',
              bundleName: 'commercebundle1',
              bundleConfig: { instanceId: 'bjmp_prd' },
            },
          },
        ],
      },
      undeploy: { components: [{ type: 'DataLakeObject', name: 'Customer__dll' }] },
    };
    const files = Object.fromEntries(
      await Promise.all(
        Object.entries(definitions).map(async ([name, definition]) => {
          const path = join(directory, `${name}.json`);
          await writeFile(path, JSON.stringify(definition));
          return [name, path];
        })
      )
    );
    const common = ['--target-org', org.username, '--api-version', '67.0', '--json'];
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'];
    const runCommand = async <T>(run: () => Promise<T>): Promise<T> => {
      const original = new Map(
        signals.map((signal) => [signal, process.listeners(signal) as Array<(...args: unknown[]) => void>])
      );
      try {
        return await run();
      } finally {
        for (const signal of signals) {
          const previous = original.get(signal) ?? [];
          for (const listener of process.listeners(signal) as Array<(...args: unknown[]) => void>) {
            if (!previous.includes(listener)) process.removeListener(signal, listener);
          }
        }
      }
    };
    const captureError = async (run: () => Promise<unknown>): Promise<unknown> => {
      let error: unknown;
      try {
        await run();
      } catch (caught) {
        error = caught;
      } finally {
        process.exitCode = undefined;
      }
      return error;
    };

    try {
      expect((await runCommand(() => List.run([...common, '--namespace', 'acme']))).items).to.have.length(1);
      expect(
        (
          await runCommand(() =>
            Available.run([
              ...common,
              '--component-type',
              'DataLakeObject',
              '--data-kit',
              'CustomerFoundation',
              '--limit',
              '1',
              '--offset',
              '2',
            ])
          )
        ).items
      ).to.have.length(1);
      expect((await runCommand(() => Manifest.run([...common, '--name', 'Customer Foundation']))).items).to.have.length(
        2
      );
      expect((await runCommand(() => Create.run([...common, '--file', files.create]))).item).to.have.property(
        'devName',
        'CustomerFoundation'
      );

      for (const [label, run] of [
        [
          'update',
          (): Promise<unknown> =>
            runCommand(() => Update.run([...common, '--name', 'CustomerFoundation', '--file', files.update])),
        ],
        ['delete', (): Promise<unknown> => runCommand(() => Delete.run([...common, '--name', 'CustomerFoundation']))],
        [
          'undeploy',
          (): Promise<unknown> =>
            runCommand(() =>
              Undeploy.run([
                ...common,
                '--name',
                'CustomerFoundation',
                '--file',
                files.undeploy,
                '--data-space',
                'loyalty',
              ])
            ),
        ],
      ] as const) {
        const before = calls.length;
        const error = await captureError(run);
        expect((error as { name?: string }).name, label).to.equal('D360_CONFIRMATION_REQUIRED');
        expect(calls, label).to.have.length(before);
      }

      expect(
        (
          await runCommand(() =>
            Update.run([...common, '--name', 'CustomerFoundation', '--file', files.update, '--no-prompt'])
          )
        ).item
      ).to.have.property('devName', 'CustomerFoundation');
      expect(
        await runCommand(() => Delete.run([...common, '--name', 'CustomerFoundation', '--no-prompt']))
      ).to.deep.equal({
        deleted: true,
        name: 'CustomerFoundation',
      });
      expect(
        (
          await runCommand(() =>
            Deploy.run([...common, '--name', 'CustomerFoundation', '--file', files.deploy, '--data-space', 'loyalty'])
          )
        ).jobId
      ).to.equal('08P000000000001AAA');
      expect(
        (
          await runCommand(() =>
            Undeploy.run([
              ...common,
              '--name',
              'CustomerFoundation',
              '--file',
              files.undeploy,
              '--data-space',
              'loyalty',
              '--no-prompt',
            ])
          )
        ).jobId
      ).to.equal('08P000000000002AAA');
      expect(
        (
          await runCommand(() =>
            ComponentDependencies.run([
              ...common,
              '--name',
              'CustomerFoundation',
              '--component',
              'Customer__dll',
              '--component-type',
              'DataLakeObject',
              '--data-space',
              'loyalty',
            ])
          )
        ).items
      ).to.have.length(1);
      expect(
        (
          await runCommand(() =>
            ComponentStatus.run([...common, '--name', 'CustomerFoundation', '--component', 'Customer__dll'])
          )
        ).item
      ).to.have.nested.property('status.code', 'ACTIVE');

      const beforeInvalid = calls.length;
      expect(
        (await captureError(() => runCommand(() => Available.run([...common])))) as {
          oclif?: { exit?: number };
        }
      ).to.have.nested.property('oclif.exit', 2);
      expect(
        (await captureError(() =>
          runCommand(() => Available.run([...common, '--component-type', 'DataLakeObject']))
        )) as {
          oclif?: { exit?: number };
        }
      ).to.have.nested.property('oclif.exit', 2);
      expect(
        (await captureError(() => runCommand(() => Available.run([...common, '--limit', '201'])))) as {
          oclif?: { exit?: number };
        }
      ).to.have.nested.property('oclif.exit', 2);
      expect(
        (await captureError(() =>
          runCommand(() =>
            ComponentDependencies.run([...common, '--name', 'CustomerFoundation', '--component', 'Customer__dll'])
          )
        )) as { oclif?: { exit?: number } }
      ).to.have.nested.property('oclif.exit', 2);
      expect(calls).to.have.length(beforeInvalid);

      expect(
        calls.some(
          ({ method, url }) => method === 'GET' && url === '/services/data/v67.0/ssot/data-kits?namespace=acme'
        )
      ).to.equal(true);
      expect(
        calls.some(
          ({ method, url }) =>
            method === 'GET' &&
            url ===
              '/services/data/v67.0/ssot/data-kits/available-components?componentType=DataLakeObject&dataKitDevName=CustomerFoundation&limit=1&offset=2'
        )
      ).to.equal(true);
      expect(
        calls.some(
          ({ method, url }) =>
            method === 'GET' && url === '/services/data/v67.0/ssot/datakit/Customer%20Foundation/manifest'
        )
      ).to.equal(true);
      expect(
        calls.find(({ method, url }) => method === 'POST' && url === '/services/data/v67.0/ssot/data-kits')?.body
      ).to.deep.equal(definitions.create);
      expect(
        calls.find(
          ({ method, url }) => method === 'PATCH' && url === '/services/data/v67.0/ssot/data-kits/CustomerFoundation'
        )?.body
      ).to.deep.equal(definitions.update);
      expect(
        calls.some(
          ({ method, url }) => method === 'DELETE' && url === '/services/data/v67.0/ssot/data-kits/CustomerFoundation'
        )
      ).to.equal(true);
      expect(
        calls.find(
          ({ method, url }) =>
            method === 'POST' &&
            url === '/services/data/v67.0/ssot/data-kits/CustomerFoundation?asyncMode=true&dataspace=loyalty'
        )?.body
      ).to.deep.equal(definitions.deploy);
      expect(
        calls.find(
          ({ method, url }) =>
            method === 'POST' &&
            url === '/services/data/v67.0/ssot/data-kits/CustomerFoundation/undeploy?asyncMode=true&dataspace=loyalty'
        )?.body
      ).to.deep.equal(definitions.undeploy);
      expect(
        calls.some(
          ({ method, url }) =>
            method === 'GET' &&
            url ===
              '/services/data/v67.0/ssot/data-kits/CustomerFoundation/components/Customer__dll/dependencies?componentType=DataLakeObject&dataspace=loyalty'
        )
      ).to.equal(true);
      expect(
        calls.some(
          ({ method, url }) =>
            method === 'GET' &&
            url === '/services/data/v67.0/ssot/data-kits/CustomerFoundation/components/Customer__dll/deployment-status'
        )
      ).to.equal(true);
      expect(calls.some(({ url }) => url.includes('deployment-jobs'))).to.equal(false);
    } finally {
      await server.close();
    }
  });
});
