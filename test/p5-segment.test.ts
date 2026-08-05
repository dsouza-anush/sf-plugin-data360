import { expect } from 'chai';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import Create from '../src/commands/data360/segment/create.js';
import Deactivate from '../src/commands/data360/segment/deactivate.js';
import Delete from '../src/commands/data360/segment/delete.js';
import Get from '../src/commands/data360/segment/get.js';
import List from '../src/commands/data360/segment/list.js';
import Publish from '../src/commands/data360/segment/publish.js';
import Update from '../src/commands/data360/segment/update.js';
import { registry } from '../src/resources/registry.js';
import { assertRejects } from './helpers/async.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P5 segment family', () => {
  const commandTest = createCommandTestContext();

  it('registers the exact verified per-operation key matrix', () => {
    const resource = registry.get('segment');
    expect(resource.operations).to.deep.equal(['list', 'get', 'create', 'update', 'delete']);
    expect(resource.idKind).to.deep.equal({
      get: 'idOrApiName',
      update: 'apiName',
      delete: 'apiName',
      count: 'apiName',
      publish: 'id',
      deactivate: 'apiName',
    });
    expect(resource.actions).to.deep.equal({
      publish: { method: 'POST', path: '/segments/{key}/actions/publish' },
      deactivate: { method: 'POST', path: '/segments/{key}/actions/deactivate' },
      count: { method: 'POST', path: '/segments/{key}/actions/count' },
    });
  });

  it('uses exit 69 and a continuation action when publish polling times out', async () => {
    const command = Object.create(Publish.prototype) as Publish;
    commandTest.context.SANDBOX.stub(command as never, 'jsonEnabled').returns(true);
    commandTest.context.SANDBOX.stub(command as never, 'resolveKey').resolves('segment-id');
    commandTest.context.SANDBOX.stub(command as never, 'initializeSegment').resolves({
      flags: { name: 'High Value', wait: { milliseconds: 1 }, 'no-prompt': true },
      client: {
        request: commandTest.context.SANDBOX.stub().callsFake(async ({ method }: { method: string }) =>
          method === 'POST' ? { publishStatus: 'PUBLISHING' } : { publishStatus: 'PUBLISHING' }
        ),
      },
    });

    const error = await assertRejects(command.run());
    expect(error.name).to.equal('D360_JOB_TIMEOUT');
    expect((error as { exitCode?: number }).exitCode).to.equal(69);
    expect((error as { actions?: string[] }).actions?.join(' ')).to.include('sf data360 segment get');
  });

  it('accepts the live wrapped segment response while polling publication', async () => {
    const command = Object.create(Publish.prototype) as Publish;
    commandTest.context.SANDBOX.stub(command as never, 'jsonEnabled').returns(true);
    commandTest.context.SANDBOX.stub(command as never, 'resolveKey').resolves('segment-id');
    commandTest.context.SANDBOX.stub(command as never, 'initializeSegment').resolves({
      flags: { name: 'High Value', wait: { milliseconds: 1000 }, 'no-prompt': true },
      client: {
        request: commandTest.context.SANDBOX.stub().callsFake(async ({ method }: { method: string }) =>
          method === 'POST'
            ? { publishStatus: 'PUBLISHING' }
            : { segments: [{ apiName: 'High_Value', segmentStatus: 'ACTIVE' }] }
        ),
      },
    });

    const result = await command.run();
    expect(result.segment).to.deep.include({ apiName: 'High_Value', segmentStatus: 'ACTIVE' });
  });

  it('resolves the live Segment response shape that exposes apiName instead of segmentApiName', async () => {
    const command = Object.create(Get.prototype) as Get;
    const request = commandTest.context.SANDBOX.stub();
    request.onFirstCall().resolves({
      segments: [{ marketSegmentId: '0SG000000000001AAA', apiName: 'High_Value', displayName: 'High Value' }],
      totalSize: 1,
    });
    request.onSecondCall().resolves({
      segments: [
        {
          marketSegmentId: '0SG000000000001AAA',
          apiName: 'High_Value',
          displayName: 'High Value',
        },
      ],
    });
    request.onThirdCall().resolves({ count: 42 });
    commandTest.context.SANDBOX.stub(command as never, 'initializeSegment').resolves({
      flags: { name: 'High_Value', 'with-count': true },
      client: { request },
    });

    const result = await command.run();
    expect((result.count as { count: number }).count).to.equal(42);
    expect(result.item).to.have.property('apiName', 'High_Value');
    expect(request.secondCall.args[0].endpoint).to.equal('/segments/High_Value');
    expect(request.thirdCall.args[0].endpoint).to.equal('/segments/High_Value/actions/count');
  });

  it('runs every shipped command through exact keys and blocks unconfirmed destructive actions', async () => {
    const server = Fastify({ logger: false });
    const id = '0SG000000000001AAA';
    let item = {
      marketSegmentId: id,
      segmentApiName: 'High_Value',
      displayName: 'High Value',
      publishStatus: 'DRAFT',
    };
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    server.addHook('preHandler', async (request) => {
      calls.push({ method: request.method, path: request.url, body: request.body });
    });
    server.get('/services/data/v67.0/ssot/segments', async () => ({ segments: [item], totalSize: 1 }));
    server.post('/services/data/v67.0/ssot/segments', async (request, reply) => {
      item = { ...item, ...(request.body as typeof item) };
      return reply.code(201).send(item);
    });
    server.get('/services/data/v67.0/ssot/segments/:key', async () => item);
    server.patch('/services/data/v67.0/ssot/segments/:key', async (request) => {
      item = { ...item, ...(request.body as typeof item) };
      return item;
    });
    server.delete('/services/data/v67.0/ssot/segments/:key', async (_request, reply) => reply.code(204).send());
    server.post('/services/data/v67.0/ssot/segments/:key/actions/count', async () => ({ count: 42 }));
    server.post('/services/data/v67.0/ssot/segments/:key/actions/publish', async () => {
      item.publishStatus = 'PUBLISHED';
      return { publishStatus: 'PUBLISHING' };
    });
    server.post('/services/data/v67.0/ssot/segments/:key/actions/deactivate', async () => {
      item.publishStatus = 'INACTIVE';
      return item;
    });
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p5-segment');
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
    const directory = await mkdtemp(join(tmpdir(), 'p5-segment-'));
    const file = join(directory, 'segment.json');
    await writeFile(file, '{"segmentApiName":"High_Value","displayName":"High Value"}');
    const common = ['-o', org.username, '--api-version', '67.0', '--json'];
    try {
      expect(((await List.run(common)) as { items: unknown[] }).items).to.have.length(1);
      expect(
        ((await Get.run([...common, '-n', id, '--with-count'])) as { count: { count: number } }).count.count
      ).to.equal(42);
      await Create.run([...common, '-f', file]);
      await Update.run([...common, '-n', 'High Value', '-f', file]);
      const beforeDeactivate = calls.length;
      let confirmationError: unknown;
      try {
        await Deactivate.run([...common, '-n', 'High Value']);
      } catch (caught) {
        confirmationError = caught;
      }
      expect((confirmationError as { name?: string }).name).to.equal('D360_CONFIRMATION_REQUIRED');
      expect(calls).to.have.length(beforeDeactivate);
      await Deactivate.run([...common, '-n', 'High Value', '--no-prompt']);
      const beforePublish = calls.length;
      const publishConfirmation = await assertRejects(Publish.run([...common, '-n', 'High Value', '--wait', '1']));
      expect(publishConfirmation.name).to.equal('D360_CONFIRMATION_REQUIRED');
      expect(calls).to.have.length(beforePublish);
      const published = await Publish.run([...common, '-n', 'High Value', '--wait', '1', '--no-prompt']);
      expect(published.segment).to.have.property('publishStatus', 'PUBLISHED');
      await Delete.run([...common, '-n', 'High Value', '--no-prompt']);
      expect(calls.some(({ method, path }) => method === 'POST' && path.endsWith(`/${id}/actions/publish`))).to.equal(
        true
      );
      expect(
        calls.some(({ method, path }) => method === 'POST' && path.endsWith('/High_Value/actions/deactivate'))
      ).to.equal(true);
      expect(calls.some(({ method, path }) => method === 'PATCH' && path.endsWith('/High_Value'))).to.equal(true);
      expect(calls.some(({ method, path }) => method === 'DELETE' && path.endsWith('/High_Value'))).to.equal(true);
    } finally {
      await server.close();
    }
  });
});
