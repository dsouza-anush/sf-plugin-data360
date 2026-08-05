import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import DloCreate from '../src/commands/data360/dlo/create.js';
import DloDelete from '../src/commands/data360/dlo/delete.js';
import DloGet from '../src/commands/data360/dlo/get.js';
import DloList from '../src/commands/data360/dlo/list.js';
import DloUpdate from '../src/commands/data360/dlo/update.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P4 DLO Fastify NUT', () => {
  const commandTest = createCommandTestContext();

  it('runs stateful DLO CRUD through explicit command leaves', async () => {
    const server = Fastify({ logger: false });
    let item: Record<string, unknown> | undefined;
    server.get('/services/data/v67.0/ssot/data-lake-objects', async () => ({
      dataLakeObjects: item ? [item] : [],
    }));
    server.post('/services/data/v67.0/ssot/data-lake-objects', async (request, reply) => {
      item = { ...(request.body as Record<string, unknown>), category: 'Engagement', storageType: 'Internal' };
      return reply.code(201).send(item);
    });
    server.get('/services/data/v67.0/ssot/data-lake-objects/:name', async () => item);
    server.patch('/services/data/v67.0/ssot/data-lake-objects/:name', async (request) => {
      item = { ...item, ...(request.body as Record<string, unknown>) };
      return item;
    });
    server.delete('/services/data/v67.0/ssot/data-lake-objects/:name', async (_request, reply) => {
      item = undefined;
      return reply.code(204).send();
    });
    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p4-dlo-nut');
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
    const directory = await mkdtemp(join(tmpdir(), 'dlo-nut-'));
    const definition = join(directory, 'dlo.json');
    await writeFile(definition, '{"name":"Orders__dll","label":"Orders"}');
    const common = ['-o', org.username, '--api-version', '67.0'];

    try {
      await DloCreate.run([...common, '-f', definition, '--json']);
      expect(((await DloList.run([...common, '--json'])) as { items: unknown[] }).items).to.have.length(1);
      expect(await DloGet.run([...common, '-n', 'Orders__dll', '--json'])).to.have.property('item');
      await DloUpdate.run([...common, '-n', 'Orders__dll', '-f', definition, '--json']);
      await DloDelete.run([...common, '-n', 'Orders__dll', '--no-prompt', '--json']);
      expect(item).to.equal(undefined);
    } finally {
      await server.close();
    }
  });
});
