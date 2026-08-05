import { readFile } from 'node:fs/promises';
import { expect } from 'chai';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import Describe from '../src/commands/data360/profile/describe.js';
import Get from '../src/commands/data360/profile/get.js';
import Lookup from '../src/commands/data360/profile/lookup.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P5 profile family', () => {
  const commandTest = createCommandTestContext();
  it('publishes the verified profile command inventory', async () => {
    const snapshot = await readFile(new URL('../command-snapshot.json', import.meta.url), 'utf8');
    expect(snapshot).to.include('data360 profile get');
    expect(snapshot).to.include('data360 profile describe');
    expect(snapshot).to.include('data360 profile lookup');
  });

  it('executes verified profile variants and four encoded lookup parameters', async () => {
    const server = Fastify({ logger: false });
    const calls: string[] = [];
    server.addHook('preHandler', async (request) => calls.push(request.url));
    server.get('/services/data/v67.0/ssot/profile/Individual__dlm', async (request) => ({
      query: request.query,
      records: [],
    }));
    server.get('/services/data/v67.0/ssot/profile/Individual__dlm/:id', async (request) => ({
      id: (request.params as { id: string }).id,
    }));
    server.get('/services/data/v67.0/ssot/profile/Individual__dlm/:id/calculated-insights/:ci', async (request) => ({
      params: request.params,
    }));
    server.get('/services/data/v67.0/ssot/profile/metadata', async () => ({ models: ['Individual__dlm'] }));
    server.get('/services/data/v67.0/ssot/profile/metadata/:name', async (request) => ({
      name: (request.params as { name: string }).name,
    }));
    server.get('/services/data/v67.0/ssot/universalIdLookup/:entity/:source/:object/:record', async (request) => ({
      params: request.params,
    }));
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p5-profile');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const response = await fetch(`${base}${(request as { url: string }).url}`, {
        method: (request as { method?: string }).method,
      });
      return (await response.json()) as never;
    };
    const common = ['-o', org.username, '--api-version', '67.0', '--json'];
    try {
      await Get.run([...common, '-n', 'Individual__dlm', '--search-key', 'email=a@example.com', '--fields', 'Id,Name']);
      await Get.run([...common, '-n', 'Individual__dlm', '--id', 'record/1']);
      await Get.run([...common, '-n', 'Individual__dlm', '--id', 'record/1', '--insight', 'Revenue__cio']);
      await Describe.run(common);
      await Describe.run([...common, '-n', 'Individual__dlm']);
      await Lookup.run([
        ...common,
        '--entity',
        'Individual/Person',
        '--data-source',
        'source one',
        '--data-source-object',
        'object/two',
        '--record',
        'record three',
      ]);
      expect(calls).to.include(
        '/services/data/v67.0/ssot/profile/Individual__dlm?searchKey=email%3Da%40example.com&fields=Id%2CName'
      );
      expect(calls).to.include(
        '/services/data/v67.0/ssot/profile/Individual__dlm/record%2F1/calculated-insights/Revenue__cio'
      );
      expect(calls).to.include(
        '/services/data/v67.0/ssot/universalIdLookup/Individual%2FPerson/source%20one/object%2Ftwo/record%20three'
      );
    } finally {
      await server.close();
    }
  });
});
