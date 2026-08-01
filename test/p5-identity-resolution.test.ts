import { expect } from 'chai';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import Create from '../src/commands/data360/identity-resolution/create.js';
import Delete from '../src/commands/data360/identity-resolution/delete.js';
import Get from '../src/commands/data360/identity-resolution/get.js';
import List from '../src/commands/data360/identity-resolution/list.js';
import Run from '../src/commands/data360/identity-resolution/run.js';
import Update from '../src/commands/data360/identity-resolution/update.js';
import { registry } from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P5 identity-resolution family', () => {
  const commandTest = createCommandTestContext();

  it('registers verified CRUD and run-now without publish', () => {
    const resource = registry.get('identity-resolution');
    expect(resource.operations).to.deep.equal(['list', 'get', 'create', 'update', 'delete']);
    expect(resource.actions).to.deep.equal({
      run: {
        method: 'POST',
        path: '/identity-resolutions/{key}/actions/run-now',
      },
    });
    expect(resource.actions).not.to.have.property('publish');
    expect(resource.destructive).to.deep.equal({ delete: true, run: true });
    expect(resource.billable).to.deep.equal({ run: 'Identity Resolution' });
  });

  it('runs every shipped command through stateful exact paths and blocks unconfirmed run', async () => {
    const server = Fastify({ logger: false });
    const id = '0IR000000000001AAA';
    let item = { id, name: 'Main', label: 'Main Ruleset', status: 'DRAFT' };
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    server.addHook('preHandler', async (request) => {
      calls.push({ method: request.method, path: request.url, body: request.body });
    });
    server.get('/services/data/v67.0/ssot/identity-resolutions', async () => ({
      identityResolutions: [item],
      totalSize: 1,
    }));
    server.post('/services/data/v67.0/ssot/identity-resolutions', async (request, reply) => {
      item = { ...item, ...(request.body as typeof item) };
      return reply.code(201).send(item);
    });
    server.get('/services/data/v67.0/ssot/identity-resolutions/:key', async () => item);
    server.patch('/services/data/v67.0/ssot/identity-resolutions/:key', async (request) => {
      item = { ...item, ...(request.body as typeof item) };
      return item;
    });
    server.delete('/services/data/v67.0/ssot/identity-resolutions/:key', async (_request, reply) =>
      reply.code(204).send()
    );
    server.post('/services/data/v67.0/ssot/identity-resolutions/:key/actions/run-now', async (request) => ({
      status: 'RUNNING',
      body: request.body,
    }));
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p5-ir');
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
    const directory = await mkdtemp(join(tmpdir(), 'p5-ir-'));
    const file = join(directory, 'ruleset.json');
    await writeFile(file, '{"name":"Main","label":"Updated"}');
    const common = ['-o', org.username, '--api-version', '67.0', '--json'];
    try {
      expect(((await List.run(common)) as { items: unknown[] }).items).to.have.length(1);
      expect(((await Get.run([...common, '-n', 'Main'])) as { item: Record<string, unknown> }).item).to.include({
        id,
      });
      await Create.run([...common, '-f', file]);
      await Update.run([...common, '-n', 'Main', '-f', file]);
      const before = calls.length;
      let error: unknown;
      try {
        await Run.run([...common, '-n', 'Main']);
      } catch (caught) {
        error = caught;
      }
      expect((error as Error).message).to.include('Confirmation is required');
      expect(calls).to.have.length(before);
      expect((await Run.run([...common, '-n', 'Main', '--no-prompt'])).item).to.deep.equal({
        status: 'RUNNING',
        body: {},
      });
      await Delete.run([...common, '-n', 'Main', '--no-prompt']);
      expect(calls.map(({ method }) => method)).to.include.members(['GET', 'POST', 'PATCH', 'DELETE']);
      expect(calls.some(({ method, path }) => method === 'DELETE' && path.endsWith(`/${id}`))).to.equal(true);
      expect(calls.some(({ path }) => path.endsWith(`/${id}/actions/run-now`))).to.equal(true);
    } finally {
      await server.close();
    }
  });
});
