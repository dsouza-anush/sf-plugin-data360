import { expect } from 'chai';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import DataStreamDelete from '../src/commands/data360/data-stream/delete.js';
import DataStreamList from '../src/commands/data360/data-stream/list.js';
import DataStreamRun from '../src/commands/data360/data-stream/run.js';
import { createCommandTestContext } from './helpers/command.js';
describe('P4 data-stream Fastify NUT', () => {
  const commandTest = createCommandTestContext();
  it('runs and safely deletes a stateful external stream', async () => {
    const server = Fastify({ logger: false });
    let stream: Record<string, unknown> | undefined = {
      name: 'OrdersStream',
      connectorType: 'S3',
      externalSource: true,
    };
    server.get('/services/data/v67.0/ssot/data-streams', async () => ({ dataStreams: stream ? [stream] : [] }));
    server.get('/services/data/v67.0/ssot/data-streams/:name', async () => stream);
    server.post('/services/data/v67.0/ssot/data-streams/:name/actions/run', async (_r, reply) =>
      reply.code(202).send({ status: 'ACCEPTED' })
    );
    server.delete('/services/data/v67.0/ssot/data-streams/:name', async (request, reply) => {
      expect((request.query as { shouldDeleteDataLakeObject?: string }).shouldDeleteDataLakeObject).to.equal('false');
      stream = undefined;
      return reply.code(204).send();
    });
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('stream-nut');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string; body?: string };
      const response = await fetch(`${base}${value.url}`, { method: value.method, body: value.body });
      return (response.status === 204 ? undefined : await response.json()) as never;
    };
    const common = ['-o', org.username, '--api-version', '67.0'];
    try {
      expect(((await DataStreamList.run([...common, '--json'])) as { items: unknown[] }).items).to.have.length(1);
      await DataStreamRun.run([...common, '-n', 'OrdersStream', '--no-prompt', '--json']);
      await DataStreamDelete.run([...common, '-n', 'OrdersStream', '--no-prompt', '--json']);
      expect(stream).to.equal(undefined);
    } finally {
      await server.close();
    }
  });
});
