import { expect } from 'chai';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import Create from '../src/commands/data360/activation/create.js';
import Delete from '../src/commands/data360/activation/delete.js';
import Get from '../src/commands/data360/activation/get.js';
import List from '../src/commands/data360/activation/list.js';
import Platforms from '../src/commands/data360/activation/platforms.js';
import Results from '../src/commands/data360/activation/results.js';
import Update from '../src/commands/data360/activation/update.js';
import { registry } from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P5 activation family', () => {
  const commandTest = createCommandTestContext();
  it('registers verified ID-keyed CRUD with PUT update', () => {
    const resource = registry.get('activation');
    expect(resource.operations).to.deep.equal(['list', 'get', 'create', 'update', 'delete']);
    expect(resource.operationSpecs?.update).to.deep.equal({ method: 'PUT', path: '/activations/{key}' });
    expect(resource.idKind).to.deep.equal({
      get: 'id',
      update: 'id',
      delete: 'id',
      results: 'id',
    });
  });

  it('executes CRUD, results, and platforms through exact stateful routes', async () => {
    const server = Fastify({ logger: false });
    const id = '0AC000000000001AAA';
    let item = {
      id,
      activationId: id,
      activationName: 'Email_Activation',
      displayName: 'Email Activation',
      status: 'DRAFT',
    };
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    server.addHook('preHandler', async (request) =>
      calls.push({ method: request.method, path: request.url, body: request.body })
    );
    server.get('/services/data/v67.0/ssot/activations', async () => ({ activations: [item], totalSize: 1 }));
    server.post('/services/data/v67.0/ssot/activations', async (request, reply) =>
      reply.code(201).send({ ...item, ...(request.body as object) })
    );
    server.get('/services/data/v67.0/ssot/activations/:id', async () => item);
    server.put(
      '/services/data/v67.0/ssot/activations/:id',
      async (request) => (item = { ...item, ...(request.body as typeof item) })
    );
    server.delete('/services/data/v67.0/ssot/activations/:id', async (_request, reply) => reply.code(204).send());
    server.get('/services/data/v67.0/ssot/activations/:id/data', async () => ({ records: [{ id: '1' }] }));
    server.get('/services/data/v67.0/ssot/activation-external-platforms', async () => ({
      activationExternalPlatforms: [{ name: 'MarketingCloud' }],
    }));
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p5-activation');
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
    const directory = await mkdtemp(join(tmpdir(), 'p5-activation-'));
    const file = join(directory, 'activation.json');
    await writeFile(file, '{"activationName":"Email_Activation","displayName":"Updated"}');
    const common = ['-o', org.username, '--api-version', '67.0', '--json'];
    try {
      expect(((await List.run(common)) as { items: unknown[] }).items).to.have.length(1);
      await Get.run([...common, '-n', 'Email Activation']);
      await Create.run([...common, '-f', file]);
      await Update.run([...common, '-n', 'Email Activation', '-f', file]);
      expect((await Results.run([...common, '-n', 'Email_Activation'])).item).to.have.property('records');
      expect((await Platforms.run(common)).items).to.deep.equal([{ name: 'MarketingCloud' }]);
      const before = calls.length;
      let error: unknown;
      try {
        await Delete.run([...common, '-n', 'Email_Activation']);
      } catch (caught) {
        error = caught;
      }
      expect((error as { name?: string }).name).to.equal('D360_CONFIRMATION_REQUIRED');
      expect(calls).to.have.length(before);
      await Delete.run([...common, '-n', 'Email_Activation', '--no-prompt']);
      expect(calls.some(({ method, path }) => method === 'PUT' && path.endsWith(`/${id}`))).to.equal(true);
      expect(calls.some(({ method, path }) => method === 'GET' && path.endsWith(`/${id}/data`))).to.equal(true);
    } finally {
      await server.close();
    }
  });
});
