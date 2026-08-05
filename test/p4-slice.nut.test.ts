import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import ConnectionCreate from '../src/commands/data360/connection/create.js';
import ConnectionDelete from '../src/commands/data360/connection/delete.js';
import ConnectionDescribe from '../src/commands/data360/connection/describe.js';
import ConnectionList from '../src/commands/data360/connection/list.js';
import ConnectionValidate from '../src/commands/data360/connection/validate.js';
import ConnectorGet from '../src/commands/data360/connector/get.js';
import ConnectorList from '../src/commands/data360/connector/list.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P4 connection and connector Fastify NUT', () => {
  const commandTest = createCommandTestContext();

  it('runs representative CRUD and extras through a stateful fixture server', async () => {
    const server = Fastify({ logger: false });
    let connection: Record<string, unknown> | undefined;
    const connector = {
      name: 'MarketingCloud',
      label: 'Marketing Cloud',
      category: 'Engagement',
      ingestType: 'Batch',
      configSchema: { required: ['endpoint'] },
    };
    server.get('/services/data/v67.0/ssot/connectors', async () => ({ connectors: [connector] }));
    server.get('/services/data/v67.0/ssot/connectors/:type', async () => connector);
    server.get('/services/data/v67.0/ssot/connections', async () => ({ connections: connection ? [connection] : [] }));
    server.post('/services/data/v67.0/ssot/connections', async (request, reply) => {
      connection = { id: 'connection-id', ...(request.body as Record<string, unknown>), status: 'Active' };
      return reply.code(201).send(connection);
    });
    server.get('/services/data/v67.0/ssot/connections/:id', async () => connection);
    server.post('/services/data/v67.0/ssot/connections/:id/actions/test', async () => ({ valid: true }));
    server.post('/services/data/v67.0/ssot/connections/:id/databases', async () => ({
      databases: [{ name: 'sales' }],
    }));
    server.delete('/services/data/v67.0/ssot/connections/:id', async (_request, reply) => {
      connection = undefined;
      return reply.code(204).send();
    });
    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p4-fastify-nut');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string; body?: string };
      const response = await fetch(`${baseUrl}${value.url}`, {
        method: value.method,
        body: value.body,
        headers: value.body ? { 'content-type': 'application/json' } : undefined,
      });
      if (response.status === 204) return undefined as never;
      return (await response.json()) as never;
    };
    const directory = await mkdtemp(join(tmpdir(), 'p4-nut-'));
    const definition = join(directory, 'connection.json');
    await writeFile(definition, '{"name":"Orders","label":"Orders","connectorType":"MarketingCloud"}');
    const common = ['-o', org.username, '--api-version', '67.0'];

    try {
      expect(((await ConnectorList.run([...common, '--json'])) as { items: unknown[] }).items).to.have.length(1);
      expect(await ConnectorGet.run([...common, '-n', 'MarketingCloud', '--json'])).to.have.property('item');
      expect(await ConnectionCreate.run([...common, '-f', definition, '--json'])).to.have.property('item');
      expect((await ConnectionList.run([...common, '--json'])).items).to.have.length(1);
      expect(await ConnectionValidate.run([...common, '-n', 'Orders', '--json'])).to.deep.equal({
        result: { valid: true },
      });
      expect(
        await ConnectionDescribe.run([...common, '-n', 'Orders', '--databases', '--json'])
      ).to.have.nested.property('sections.databases');
      expect(await ConnectionDelete.run([...common, '-n', 'Orders', '--no-prompt', '--json'])).to.deep.equal({
        deleted: true,
        id: 'connection-id',
      });
      expect(connection).to.equal(undefined);
    } finally {
      await server.close();
    }
  });
});
