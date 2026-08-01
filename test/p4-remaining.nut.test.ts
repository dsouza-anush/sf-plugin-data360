import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import ConnectionGet from '../src/commands/data360/connection/get.js';
import ConnectionUpdate from '../src/commands/data360/connection/update.js';
import DmoList from '../src/commands/data360/dmo/list.js';
import DmoGet from '../src/commands/data360/dmo/get.js';
import DmoUpdate from '../src/commands/data360/dmo/update.js';
import MappingGet from '../src/commands/data360/mapping/get.js';
import StreamGet from '../src/commands/data360/data-stream/get.js';
import StreamCreate from '../src/commands/data360/data-stream/create.js';
import StreamUpdate from '../src/commands/data360/data-stream/update.js';
import TransformList from '../src/commands/data360/transform/list.js';
import TransformGet from '../src/commands/data360/transform/get.js';
import TransformCreate from '../src/commands/data360/transform/create.js';
import TransformUpdate from '../src/commands/data360/transform/update.js';
import TransformDelete from '../src/commands/data360/transform/delete.js';
import TransformRetry from '../src/commands/data360/transform/retry.js';
import TransformCancel from '../src/commands/data360/transform/cancel.js';
import TransformValidate from '../src/commands/data360/transform/validate.js';
import ScheduleDisplay from '../src/commands/data360/transform/schedule/display.js';
import SpaceList from '../src/commands/data360/data-space/list.js';
import SpaceGet from '../src/commands/data360/data-space/get.js';
import SpaceCreate from '../src/commands/data360/data-space/create.js';
import SpaceUpdate from '../src/commands/data360/data-space/update.js';
import { assertRejects } from './helpers/async.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P4 remaining command-level Fastify matrix', () => {
  const commandTest = createCommandTestContext();
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'];
  const run = async <T>(command: { run: (argv: string[]) => Promise<T> }, argv: string[]): Promise<T> => {
    const listeners = new Map(signals.map((signal) => [signal, process.listeners(signal)]));
    try {
      return await command.run(argv);
    } finally {
      for (const signal of signals) {
        const original = listeners.get(signal) ?? [];
        for (const listener of process.listeners(signal)) {
          if (!original.includes(listener)) process.removeListener(signal, listener);
        }
      }
    }
  };
  it('executes every remaining parser with its explicit wire contract', async function () {
    this.timeout(process.platform === 'win32' ? 120_000 : 10_000);
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const server = Fastify({ logger: false });
    server.route({
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      url: '/services/data/v67.0/ssot/*',
      handler: async (request, reply) => {
        requests.push({ method: request.method, url: request.url, body: request.body });
        const path = request.url.split('?')[0];
        if (request.method === 'DELETE') return reply.code(204).send();
        if (path.endsWith('/connectors')) return { connectors: [{ type: 'MarketingCloud' }] };
        if (path.endsWith('/connections'))
          return {
            connections: [{ id: 'connection-id', name: 'Orders', label: 'Orders', connectorType: 'MarketingCloud' }],
          };
        if (path.endsWith('/data-model-objects'))
          return { dataModelObjects: [{ name: 'Order', label: 'Order', mappedDlos: [] }] };
        if (path.endsWith('/data-streams')) return { dataStreams: [{ name: 'OrdersStream', label: 'Orders Stream' }] };
        if (path.endsWith('/data-transforms'))
          return { dataTransforms: [{ name: 'OrdersTransform', label: 'Orders Transform' }] };
        if (path.endsWith('/data-spaces')) return { dataSpaces: [{ name: 'default', label: 'Default' }] };
        if (request.body) return request.body;
        return { name: path.split('/').at(-1), connectorType: 'MarketingCloud' };
      },
    });
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p4-remaining');
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
    const directory = await mkdtemp(join(tmpdir(), 'p4-remaining-'));
    const file = join(directory, 'definition.json');
    await writeFile(file, '{"name":"Updated"}');
    const common = ['-o', org.username, '--api-version', '67.0'];
    const assertWire = (method: string, path: string): void => {
      expect(
        requests.some((request) => request.method === method && request.url.split('?')[0].endsWith(path))
      ).to.equal(true);
      requests.length = 0;
    };

    await run(ConnectionGet, [...common, '-n', 'orders', '--json']);
    assertWire('GET', '/connections/connection-id');
    await run(ConnectionUpdate, [...common, '-n', 'orders', '-f', file, '--json']);
    assertWire('PATCH', '/connections/connection-id');
    await run(DmoList, [...common, '--json']);
    assertWire('GET', '/data-model-objects');
    await run(DmoGet, [...common, '-n', 'order', '--json']);
    assertWire('GET', '/data-model-objects/Order');
    await run(DmoUpdate, [...common, '-n', 'order', '-f', file, '--json']);
    assertWire('PATCH', '/data-model-objects/Order');
    await run(MappingGet, [...common, '-n', 'OrdersToIndividual', '--json']);
    assertWire('GET', '/data-model-object-mappings/OrdersToIndividual');
    await run(StreamGet, [...common, '-n', 'orders stream', '--json']);
    assertWire('GET', '/data-streams/OrdersStream');
    await run(StreamCreate, [...common, '-f', file, '--json']);
    assertWire('POST', '/data-streams');
    await run(StreamUpdate, [...common, '-n', 'orders stream', '-f', file, '--json']);
    assertWire('PATCH', '/data-streams/OrdersStream');
    await run(TransformList, [...common, '--json']);
    assertWire('GET', '/data-transforms');
    await run(TransformGet, [...common, '-n', 'orders transform', '--json']);
    assertWire('GET', '/data-transforms/OrdersTransform');
    await run(TransformCreate, [...common, '-f', file, '--json']);
    assertWire('POST', '/data-transforms');
    await run(TransformUpdate, [...common, '-n', 'orders transform', '-f', file, '--json']);
    assertWire('PUT', '/data-transforms/OrdersTransform');
    const beforeDelete = requests.length;
    await assertRejects(run(TransformDelete, [...common, '-n', 'orders transform', '--json']));
    expect(requests.filter((request) => request.method === 'DELETE')).to.have.length(0);
    expect(requests.length).to.be.greaterThanOrEqual(beforeDelete);
    requests.length = 0;
    await run(TransformDelete, [...common, '-n', 'orders transform', '--no-prompt', '--json']);
    assertWire('DELETE', '/data-transforms/OrdersTransform');
    await run(TransformRetry, [...common, '-n', 'orders transform', '--no-prompt', '--json']);
    assertWire('POST', '/data-transforms/OrdersTransform/actions/retry');
    await assertRejects(run(TransformCancel, [...common, '-n', 'orders transform', '--json']));
    expect(
      requests.filter((request) => request.method === 'POST' && request.url.includes('/actions/cancel'))
    ).to.have.length(0);
    requests.length = 0;
    await run(TransformCancel, [...common, '-n', 'orders transform', '--no-prompt', '--json']);
    assertWire('POST', '/data-transforms/OrdersTransform/actions/cancel');
    await run(TransformValidate, [...common, '-n', 'orders transform', '--json']);
    assertWire('POST', '/data-transforms/OrdersTransform/actions/validate');
    await run(ScheduleDisplay, [...common, '-n', 'orders transform', '--json']);
    assertWire('GET', '/data-transforms/OrdersTransform/schedule');
    await run(SpaceList, [...common, '--json']);
    assertWire('GET', '/data-spaces');
    await run(SpaceGet, [...common, '-n', 'default', '--json']);
    assertWire('GET', '/data-spaces/default');
    await run(SpaceCreate, [...common, '-f', file, '--json']);
    assertWire('POST', '/data-spaces');
    await run(SpaceUpdate, [...common, '-n', 'default', '-f', file, '--json']);
    assertWire('PATCH', '/data-spaces/default');
    await server.close();
  });
});
