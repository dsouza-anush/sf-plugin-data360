import { expect } from 'chai';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import Create from '../src/commands/data360/data-graph/create.js';
import Delete from '../src/commands/data360/data-graph/delete.js';
import Get from '../src/commands/data360/data-graph/get.js';
import List from '../src/commands/data360/data-graph/list.js';
import Query from '../src/commands/data360/data-graph/query.js';
import Refresh from '../src/commands/data360/data-graph/refresh.js';
import { registry } from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P5 data-graph family', () => {
  const commandTest = createCommandTestContext();
  it('registers source-verified operations and metadata list only', () => {
    const resource = registry.get('data-graph');
    expect(resource.operations).to.deep.equal(['list', 'get', 'create', 'delete']);
    expect(resource.operationSpecs?.list?.path).to.equal('/data-graphs/metadata');
    expect(resource.actions).to.deep.equal({
      refresh: {
        method: 'POST',
        path: '/data-graphs/{key}/actions/refresh',
        resolveName: false,
        timeoutMs: 120_000,
        outcomeUnknownRecoveryCommand:
          'Run sf data360 data-graph get --name <name> --target-org <alias> before retrying.',
      },
    });
    expect(resource.operations).not.to.include('update');
  });

  it('executes metadata CRUD, refresh, and both exact data query forms', async () => {
    const server = Fastify({ logger: false });
    const item = {
      developerName: 'Customer_Graph',
      displayName: 'Customer Graph',
      dataGraphEntityName: 'UnifiedIndividual__dlm',
      status: 'ACTIVE',
    };
    const calls: Array<{ method: string; path: string }> = [];
    server.addHook('preHandler', async (request) => calls.push({ method: request.method, path: request.url }));
    server.get('/services/data/v67.0/ssot/data-graphs/metadata', async () => ({ dataGraphs: [item], totalSize: 1 }));
    server.post('/services/data/v67.0/ssot/data-graphs', async (request, reply) =>
      reply.code(201).send({ ...item, ...(request.body as object) })
    );
    server.get('/services/data/v67.0/ssot/data-graphs/:name', async () => item);
    server.delete('/services/data/v67.0/ssot/data-graphs/:name', async (_request, reply) => reply.code(204).send());
    server.post('/services/data/v67.0/ssot/data-graphs/:name/actions/refresh', async () => ({ status: 'REFRESHING' }));
    server.get('/services/data/v67.0/ssot/data-graphs/data/:entity/:id', async (request) => ({
      entity: (request.params as { entity: string }).entity,
      id: (request.params as { id: string }).id,
    }));
    server.get('/services/data/v67.0/ssot/data-graphs/data/:entity', async (request) => ({
      entity: (request.params as { entity: string }).entity,
      query: request.query,
    }));
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p5-data-graph');
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
    const directory = await mkdtemp(join(tmpdir(), 'p5-graph-'));
    const definition = join(directory, 'graph.json');
    const output = join(directory, 'result.json');
    await writeFile(definition, '{"dataGraphName":"Customer_Graph","displayName":"Customer Graph"}');
    const common = ['-o', org.username, '--api-version', '67.0', '--json'];
    try {
      expect(((await List.run(common)) as { items: unknown[] }).items).to.have.length(1);
      await Get.run([...common, '-n', 'Customer Graph']);
      await Create.run([...common, '-f', definition]);
      const beforeRefresh = calls.length;
      await Refresh.run([...common, '-n', 'Customer_Graph', '--no-prompt']);
      expect(calls.slice(beforeRefresh)).to.deep.equal([
        { method: 'POST', path: '/services/data/v67.0/ssot/data-graphs/Customer_Graph/actions/refresh' },
      ]);
      const byId = await Query.run([...common, '-n', 'Customer Graph', '--id', 'record/1', '--live']);
      expect(byId.item).to.include({ entity: 'UnifiedIndividual__dlm', id: 'record/1' });
      const byLookup = await Query.run([
        ...common,
        '-n',
        'Customer Graph',
        '--lookup-keys',
        'email=a@example.com',
        '--live',
        '--output-file',
        output,
      ]);
      expect(byLookup.item).to.have.nested.property('query.lookupKeys', 'email=a@example.com');
      expect(JSON.parse(await readFile(output, 'utf8'))).to.deep.equal(byLookup.item);
      await Delete.run([...common, '-n', 'Customer Graph', '--no-prompt']);
      expect(calls.some(({ path }) => path.includes('/data/UnifiedIndividual__dlm/record%2F1?live=true'))).to.equal(
        true
      );
      expect(
        calls.some(({ method, path }) => method === 'POST' && path.endsWith('/Customer_Graph/actions/refresh'))
      ).to.equal(true);
    } finally {
      await server.close();
    }
  });
});
