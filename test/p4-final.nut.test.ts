import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import Fastify from 'fastify';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import TransformRun from '../src/commands/data360/transform/run.js';
import TransformReport from '../src/commands/data360/transform/report.js';
import ScheduleSet from '../src/commands/data360/transform/schedule/set.js';
import MemberSet from '../src/commands/data360/data-space/member/set.js';
import MemberList from '../src/commands/data360/data-space/member/list.js';
import { createCommandTestContext } from './helpers/command.js';
describe('P4 transform and data-space Fastify NUT', () => {
  const commandTest = createCommandTestContext();
  it('runs transform lifecycle and member upsert', async () => {
    const server = Fastify({ logger: false });
    let members: Array<Record<string, unknown>> = [];
    server.post('/services/data/v67.0/ssot/data-transforms/:name/actions/run', async (request) => {
      expect(request.body).to.deep.equal({});
      return { status: 'RUNNING' };
    });
    server.post('/services/data/v67.0/ssot/data-transforms/:name/actions/refresh-status', async () => ({
      status: 'SUCCESS',
    }));
    server.get('/services/data/v67.0/ssot/data-transforms/:name/run-history', async () => ({
      runs: [{ status: 'SUCCESS' }],
    }));
    server.put('/services/data/v67.0/ssot/data-transforms/:name/schedule', async (r) => r.body);
    server.get('/services/data/v67.0/ssot/data-spaces/:name/members', async () => ({ members }));
    server.get('/services/data/v67.0/ssot/data-spaces', async () => ({
      dataSpaces: [{ name: 'default', label: 'Default' }],
    }));
    server.put('/services/data/v67.0/ssot/data-spaces/:name/members', async (r) => {
      members = (r.body as { members: { members: Array<Record<string, unknown>> } }).members.members;
      return { members };
    });
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('final-nut');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const v = request as { method?: string; url?: string; body?: string };
      const response = await fetch(`${base}${v.url}`, {
        method: v.method,
        body: v.body,
        headers: v.body ? { 'content-type': 'application/json' } : undefined,
      });
      return (await response.json()) as never;
    };
    const dir = await mkdtemp(join(tmpdir(), 'final-nut-'));
    const file = join(dir, 'members.json');
    await writeFile(
      file,
      '{"members":[{"memberName":"Order__dll","filter":{"conjunctiveOperator":"NoneOperator","conditions":{"conditions":[]}}}]}'
    );
    const common = ['-o', org.username, '--api-version', '67.0'];
    try {
      await TransformRun.run([...common, '-n', 'OrdersTransform', '--no-prompt', '--json']);
      const report = await TransformReport.run([...common, '-n', 'OrdersTransform', '--history', '--json']);
      expect(report.history).to.deep.equal({ runs: [{ status: 'SUCCESS' }] });
      await ScheduleSet.run([...common, '-n', 'OrdersTransform', '--cron', '0 0 * * *', '--no-prompt', '--json']);
      await MemberSet.run([...common, '-n', 'default', '-f', file, '--no-prompt', '--json']);
      expect((await MemberList.run([...common, '-n', 'default', '--json'])).items).to.have.length(1);
    } finally {
      await server.close();
    }
  });
});
