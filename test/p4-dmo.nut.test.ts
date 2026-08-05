import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import DmoCreate from '../src/commands/data360/dmo/create.js';
import DmoDelete from '../src/commands/data360/dmo/delete.js';
import DmoRelationshipCreate from '../src/commands/data360/dmo/relationship/create.js';
import DmoRelationshipDelete from '../src/commands/data360/dmo/relationship/delete.js';
import DmoRelationshipList from '../src/commands/data360/dmo/relationship/list.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P4 DMO Fastify NUT', () => {
  const commandTest = createCommandTestContext();

  it('runs from-DLO creation and stateful relationship paths', async () => {
    const server = Fastify({ logger: false });
    let dmo: Record<string, unknown> | undefined;
    let relationship: Record<string, unknown> | undefined;
    server.get('/services/data/v67.0/ssot/data-lake-objects/:name', async () => ({
      name: 'Orders__dll',
      label: 'Orders',
      category: 'Engagement',
      fields: [{ name: 'Id__c', dataType: 'VARCHAR', isPrimaryKey: true }],
    }));
    server.get('/services/data/v67.0/ssot/data-model-objects', async () => ({ dataModelObjects: dmo ? [dmo] : [] }));
    server.post('/services/data/v67.0/ssot/data-model-objects', async (request, reply) => {
      dmo = request.body as Record<string, unknown>;
      return reply.code(201).send(dmo);
    });
    server.get('/services/data/v67.0/ssot/data-model-objects/:name/relationships', async () => ({
      relationships: relationship ? [relationship] : [],
    }));
    server.post('/services/data/v67.0/ssot/data-model-objects/:name/relationships', async (request, reply) => {
      relationship = request.body as Record<string, unknown>;
      return reply.code(201).send(relationship);
    });
    server.delete('/services/data/v67.0/ssot/data-model-objects/relationships/:name', async (_request, reply) => {
      relationship = undefined;
      return reply.code(204).send();
    });
    server.delete('/services/data/v67.0/ssot/data-model-objects/:name', async (_request, reply) => {
      dmo = undefined;
      return reply.code(204).send();
    });
    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p4-dmo-nut');
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
    const directory = await mkdtemp(join(tmpdir(), 'dmo-nut-'));
    const definition = join(directory, 'relationship.json');
    await writeFile(definition, '{"name":"OrderContact","targetObject":"Contact"}');
    const common = ['-o', org.username, '--api-version', '67.0'];

    try {
      await DmoCreate.run([...common, '--from-dlo', 'Orders__dll', '--json']);
      await DmoRelationshipCreate.run([...common, '-n', 'Orders', '-f', definition, '--json']);
      expect((await DmoRelationshipList.run([...common, '-n', 'Orders', '--json'])).items).to.have.length(1);
      await DmoRelationshipDelete.run([...common, '--relationship-name', 'OrderContact', '--no-prompt', '--json']);
      await DmoDelete.run([...common, '-n', 'Orders', '--no-prompt', '--json']);
      expect({ dmo, relationship }).to.deep.equal({ dmo: undefined, relationship: undefined });
    } finally {
      await server.close();
    }
  });
});
