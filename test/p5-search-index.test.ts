import { expect } from 'chai';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import Create from '../src/commands/data360/search-index/create.js';
import Delete from '../src/commands/data360/search-index/delete.js';
import Describe from '../src/commands/data360/search-index/describe.js';
import Get from '../src/commands/data360/search-index/get.js';
import List from '../src/commands/data360/search-index/list.js';
import Update from '../src/commands/data360/search-index/update.js';
import { registry } from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P5 search-index family', () => {
  const commandTest = createCommandTestContext();
  it('registers verified CRUD and detail-backed configuration without process history', () => {
    const resource = registry.get('search-index');
    expect(resource.operations).to.deep.equal(['list', 'get', 'create', 'update', 'delete']);
    expect(resource.actions).to.deep.equal({
      describe: { method: 'GET', path: '/search-index/{key}' },
    });
    expect(resource.actions).not.to.have.property('report');
  });

  it('executes every shipped command with exact CRUD and describe paths', async () => {
    const server = Fastify({ logger: false });
    const id = '0SI000000000001AAA';
    let item = { id, developerName: 'Knowledge_Index', displayName: 'Knowledge Index', runtimeStatus: 'ACTIVE' };
    const calls: Array<{ method: string; path: string }> = [];
    server.addHook('preHandler', async (request) => calls.push({ method: request.method, path: request.url }));
    server.get('/services/data/v67.0/ssot/search-index', async () => ({
      semanticSearchDefinitionDetails: [item],
      totalSize: 1,
    }));
    server.post('/services/data/v67.0/ssot/search-index', async (request, reply) =>
      reply.code(201).send({ ...item, ...(request.body as object) })
    );
    server.get('/services/data/v67.0/ssot/search-index/:key', async () => item);
    server.patch(
      '/services/data/v67.0/ssot/search-index/:key',
      async (request) => (item = { ...item, ...(request.body as typeof item) })
    );
    server.delete('/services/data/v67.0/ssot/search-index/:key', async (_request, reply) => reply.code(204).send());
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p5-search-index');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string; body?: string };
      const response = await fetch(`${base}${value.url}`, {
        method: value.method,
        body: value.body,
        headers: value.body ? { 'content-type': 'application/json' } : undefined,
      });
      if (response.status === 204) return undefined as never;
      return (await response.json()) as never;
    };
    const directory = await mkdtemp(join(tmpdir(), 'p5-search-'));
    const file = join(directory, 'index.json');
    await writeFile(file, '{"developerName":"Knowledge_Index","displayName":"Knowledge Index"}');
    const common = ['-o', org.username, '--api-version', '67.0', '--json'];
    try {
      expect(((await List.run(common)) as { items: unknown[] }).items).to.have.length(1);
      await Get.run([...common, '-n', 'Knowledge Index']);
      await Create.run([...common, '-f', file]);
      await Update.run([...common, '-n', 'Knowledge Index', '-f', file]);
      expect(
        ((await Describe.run([...common, '-n', 'Knowledge Index'])) as { item: Record<string, unknown> }).item
      ).to.have.property('developerName', 'Knowledge_Index');
      await Delete.run([...common, '-n', 'Knowledge Index', '--no-prompt']);
      expect(calls.some(({ method, path }) => method === 'GET' && path.endsWith('/Knowledge_Index'))).to.equal(true);
      expect(calls.some(({ method, path }) => method === 'PATCH' && path.endsWith('/Knowledge_Index'))).to.equal(true);
      expect(calls.some(({ method, path }) => method === 'DELETE' && path.endsWith(`/${id}`))).to.equal(true);
    } finally {
      await server.close();
    }
  });
});
