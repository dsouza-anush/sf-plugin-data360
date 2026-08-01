import { expect } from 'chai';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import Create from '../src/commands/data360/calculated-insight/create.js';
import Delete from '../src/commands/data360/calculated-insight/delete.js';
import Get from '../src/commands/data360/calculated-insight/get.js';
import List from '../src/commands/data360/calculated-insight/list.js';
import Query from '../src/commands/data360/calculated-insight/query.js';
import Run from '../src/commands/data360/calculated-insight/run.js';
import Update from '../src/commands/data360/calculated-insight/update.js';
import { registry } from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P5 calculated-insight family', () => {
  const commandTest = createCommandTestContext();

  it('registers verified CRUD, run, values, and metadata only', () => {
    const resource = registry.get('calculated-insight');
    expect(resource.operations).to.deep.equal(['list', 'get', 'create', 'update', 'delete']);
    expect((resource as typeof resource & { apiNameSuffix?: string }).apiNameSuffix).to.equal('__cio');
    expect(resource.actions).to.deep.equal({
      run: { method: 'POST', path: '/calculated-insights/{key}/actions/run' },
    });
    expect(resource.actions).not.to.have.any.keys('report', 'validate', 'enable', 'disable');
  });

  it('runs every shipped command with suffix validation and exact values/metadata queries', async () => {
    const server = Fastify({ logger: false });
    let item = { apiName: 'Revenue__cio', displayName: 'Revenue', status: 'DRAFT' };
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    server.addHook('preHandler', async (request) => {
      calls.push({ method: request.method, path: request.url, body: request.body });
    });
    // The live API wraps calculated insights in collection.items rather than the
    // top-level calculatedInsights array used by the original synthetic fixture.
    server.get('/services/data/v67.0/ssot/calculated-insights', async () => ({
      collection: {
        count: 1,
        items: [item],
        nextPageUrl: null,
        total: 1,
      },
    }));
    server.post('/services/data/v67.0/ssot/calculated-insights', async (request, reply) => {
      item = { ...item, ...(request.body as typeof item) };
      return reply.code(201).send(item);
    });
    server.get('/services/data/v67.0/ssot/calculated-insights/:name', async () => item);
    server.patch('/services/data/v67.0/ssot/calculated-insights/:name', async (request) => {
      item = { ...item, ...(request.body as typeof item) };
      return item;
    });
    server.delete('/services/data/v67.0/ssot/calculated-insights/:name', async (_request, reply) =>
      reply.code(204).send()
    );
    server.post('/services/data/v67.0/ssot/calculated-insights/:name/actions/run', async () => ({
      success: true,
      errors: [],
    }));
    server.get('/services/data/v67.0/ssot/insight/calculated-insights/:name', async (request) => ({
      query: request.query,
      data: [{ Country: 'US', Revenue: 42 }],
    }));
    server.get('/services/data/v67.0/ssot/insight/metadata/:name', async () => ({
      apiName: 'Revenue__cio',
      dimensions: [{ name: 'Country' }],
    }));
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p5-ci');
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
    const directory = await mkdtemp(join(tmpdir(), 'p5-ci-'));
    const valid = join(directory, 'valid.json');
    const invalid = join(directory, 'invalid.json');
    await writeFile(valid, '{"apiName":"Revenue__cio","displayName":"Revenue"}');
    await writeFile(invalid, '{"apiName":"Revenue","displayName":"Revenue"}');
    const common = ['-o', org.username, '--api-version', '67.0', '--json'];
    try {
      expect(((await List.run(common)) as { items: unknown[] }).items).to.have.length(1);
      await Get.run([...common, '-n', 'Revenue']);
      await Create.run([...common, '-f', valid]);
      const before = calls.length;
      let suffixError: unknown;
      try {
        await Create.run([...common, '-f', invalid]);
      } catch (caught) {
        suffixError = caught;
      }
      expect((suffixError as { name?: string }).name).to.equal('D360_INVALID_DEFINITION');
      expect(calls).to.have.length(before);
      await Update.run([...common, '-n', 'Revenue', '-f', valid]);
      let confirmationError: Error | undefined;
      try {
        await Run.run([...common, '-n', 'Revenue']);
      } catch (error) {
        confirmationError = error as Error;
      }
      expect(confirmationError).to.have.property('name', 'D360_CONFIRMATION_REQUIRED');
      expect(
        ((await Run.run([...common, '-n', 'Revenue', '--no-prompt'])) as { item: Record<string, unknown> }).item
      ).to.deep.equal({
        success: true,
        errors: [],
      });
      const values = (await Query.run([
        ...common,
        '-n',
        'Revenue',
        '--dimensions',
        'Country',
        '--measures',
        'Revenue',
        '--filters',
        "Country='US'",
        '--time-granularity',
        'DAY',
      ])) as { item: { query: Record<string, string> } };
      expect(values.item.query).to.deep.equal({
        dimensions: 'Country',
        measures: 'Revenue',
        filters: "Country='US'",
        timeGranularity: 'DAY',
      });
      expect(
        ((await Query.run([...common, '-n', 'Revenue', '--describe'])) as { item: Record<string, unknown> }).item
      ).to.have.property('apiName', 'Revenue__cio');
      await Delete.run([...common, '-n', 'Revenue', '--no-prompt']);
      expect(calls.some(({ path }) => path.endsWith('/Revenue__cio/actions/run'))).to.equal(true);
      expect(calls.some(({ path }) => path.endsWith('/calculated-insights/Revenue__cio'))).to.equal(true);
    } finally {
      await server.close();
    }
  });
});
