import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import MappingCreate from '../src/commands/data360/mapping/create.js';
import MappingDelete from '../src/commands/data360/mapping/delete.js';
import MappingList from '../src/commands/data360/mapping/list.js';
import MappingUpdate from '../src/commands/data360/mapping/update.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P4 mapping Fastify NUT', () => {
  const commandTest = createCommandTestContext();
  it('runs stateful mapping CRUD and field operations', async () => {
    const server = Fastify({ logger: false });
    let mapping: Record<string, unknown> | undefined;
    server.get('/services/data/v67.0/ssot/data-model-object-mappings', async () => ({
      objectSourceTargetMaps: mapping ? [mapping] : [],
    }));
    server.post('/services/data/v67.0/ssot/data-model-object-mappings', async (request, reply) => {
      mapping = request.body as Record<string, unknown>;
      return reply.code(201).send(mapping);
    });
    server.patch('/services/data/v67.0/ssot/data-model-object-mappings/:name/field-mappings/:field', async () => ({
      success: true,
    }));
    server.delete(
      '/services/data/v67.0/ssot/data-model-object-mappings/:name/field-mappings/:field',
      async (_r, reply) => reply.code(204).send()
    );
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('mapping-nut');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string; body?: string };
      const response = await fetch(`${base}${value.url}`, {
        method: value.method,
        body: value.body,
        headers: value.body ? { 'content-type': 'application/json' } : undefined,
      });
      return (response.status === 204 ? undefined : await response.json()) as never;
    };
    const dir = await mkdtemp(join(tmpdir(), 'mapping-nut-'));
    const definition = join(dir, 'mapping.json');
    const fields = join(dir, 'fields.json');
    await writeFile(definition, '{"name":"OrdersToIndividual"}');
    await writeFile(fields, '{"fieldMappings":[{"name":"EmailMap"}]}');
    const common = ['-o', org.username, '--api-version', '67.0'];
    try {
      await MappingCreate.run([...common, '-f', definition, '--json']);
      expect((await MappingList.run([...common, '--dmo', 'Individual__dlm', '--json'])).items).to.have.length(1);
      await MappingUpdate.run([...common, '-n', 'OrdersToIndividual', '-f', fields, '--json']);
      await MappingDelete.run([...common, '-n', 'OrdersToIndividual', '--fields', 'EmailMap', '--no-prompt', '--json']);
    } finally {
      await server.close();
    }
  });
});
