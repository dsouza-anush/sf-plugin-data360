import { expect } from 'chai';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import Create from '../src/commands/data360/activation-target/create.js';
import Get from '../src/commands/data360/activation-target/get.js';
import List from '../src/commands/data360/activation-target/list.js';
import Update from '../src/commands/data360/activation-target/update.js';
import { registry } from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';

describe('P5 activation-target family', () => {
  const commandTest = createCommandTestContext();
  it('registers verified PATCH operations without delete', () => {
    const resource = registry.get('activation-target');
    expect(resource.operations).to.deep.equal(['list', 'get', 'create', 'update']);
    expect(resource.operationSpecs?.update).to.deep.equal({ method: 'PATCH', path: '/activation-targets/{key}' });
    expect((resource as typeof resource & { numericRanges?: unknown }).numericRanges).to.deep.equal({
      maxFileSize: { min: 1, max: 500 },
    });
  });

  it('executes all commands and rejects out-of-range maxFileSize without requests', async () => {
    const server = Fastify({ logger: false });
    const id = '0AT000000000001AAA';
    let item = {
      id,
      activationTargetId: id,
      activationTargetName: 'S3_Target',
      displayName: 'S3 Target',
      maxFileSize: 100,
    };
    const calls: Array<{ method: string; path: string }> = [];
    server.addHook('preHandler', async (request) => calls.push({ method: request.method, path: request.url }));
    server.get('/services/data/v67.0/ssot/activation-targets', async () => ({
      activationTargets: [item],
      totalSize: 1,
    }));
    server.post('/services/data/v67.0/ssot/activation-targets', async (request, reply) =>
      reply.code(201).send({ ...item, ...(request.body as object) })
    );
    server.get('/services/data/v67.0/ssot/activation-targets/:id', async () => item);
    server.patch(
      '/services/data/v67.0/ssot/activation-targets/:id',
      async (request) => (item = { ...item, ...(request.body as typeof item) })
    );
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('p5-activation-target');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string; body?: string };
      const response = await fetch(`${base}${value.url}`, {
        method: value.method,
        body: value.body,
        headers: value.body ? { 'content-type': 'application/json' } : undefined,
      });
      return (await response.json()) as never;
    };
    const directory = await mkdtemp(join(tmpdir(), 'p5-target-'));
    const valid = join(directory, 'valid.json');
    const invalid = join(directory, 'invalid.json');
    await writeFile(valid, '{"activationTargetName":"S3_Target","maxFileSize":500}');
    await writeFile(invalid, '{"activationTargetName":"S3_Target","maxFileSize":501}');
    const common = ['-o', org.username, '--api-version', '67.0', '--json'];
    try {
      expect(((await List.run(common)) as { items: unknown[] }).items).to.have.length(1);
      await Get.run([...common, '-n', 'S3 Target']);
      await Create.run([...common, '-f', valid]);
      await Update.run([...common, '-n', 'S3 Target', '-f', valid]);
      const before = calls.length;
      let error: unknown;
      try {
        await Create.run([...common, '-f', invalid]);
      } catch (caught) {
        error = caught;
      }
      expect((error as { name?: string }).name).to.equal('D360_INVALID_DEFINITION');
      expect(calls).to.have.length(before);
      expect(calls.some(({ method, path }) => method === 'PATCH' && path.endsWith(`/${id}`))).to.equal(true);
    } finally {
      await server.close();
    }
  });
});
