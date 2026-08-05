import { expect } from 'chai';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import TransformCancel from '../src/commands/data360/transform/cancel.js';
import TransformReport from '../src/commands/data360/transform/report.js';
import TransformRun from '../src/commands/data360/transform/run.js';
import TransformScheduleDisplay from '../src/commands/data360/transform/schedule/display.js';
import TransformScheduleSet from '../src/commands/data360/transform/schedule/set.js';
import TransformUpdate from '../src/commands/data360/transform/update.js';
import { registry } from '../src/resources/registry.js';
import { createCommandTestContext } from './helpers/command.js';
describe('P4 transform family', () => {
  const commandTest = createCommandTestContext();
  it('registers PUT update and verified actions only', () => {
    const resource = registry.get('transform');
    expect(resource.operationSpecs?.update?.method).to.equal('PUT');
    expect(resource.columns).to.deep.equal(['name', 'label', 'type', 'status']);
    expect(resource.actions).to.have.keys([
      'run',
      'retry',
      'cancel',
      'report',
      'validate',
      'history',
      'scheduleDisplay',
      'scheduleSet',
    ]);
    expect(resource.actions?.run).to.deep.include({
      timeoutMs: 120_000,
      outcomeUnknownRecoveryCommand:
        'Run sf data360 transform report --name <name> --target-org <alias> before retrying.',
    });
  });
  it('uses PUT update and verified action, history, confirmation, and schedule methods', async () => {
    const org = new MockTestOrgData('transform');
    await commandTest.context.stubAuths(org);
    const requests: Array<{ method?: string; url?: string; body?: string }> = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string; body?: string };
      requests.push(value);
      if (value.url?.endsWith('/data-transforms')) return { dataTransforms: [{ name: 'OrdersTransform' }] } as never;
      if (value.method === 'DELETE') return undefined as never;
      return (value.body ? JSON.parse(value.body) : { name: 'OrdersTransform', status: 'ACTIVE' }) as never;
    };
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'transform-'));
    const file = join(dir, 'transform.json');
    await writeFile(file, '{"name":"OrdersTransform"}');
    await TransformUpdate.run(['-o', org.username, '-n', 'OrdersTransform', '-f', file, '--json']);
    let confirmationError: Error | undefined;
    try {
      await TransformRun.run(['-o', org.username, '-n', 'OrdersTransform', '--json']);
    } catch (error) {
      confirmationError = error as Error;
    }
    expect(confirmationError).to.have.property('name', 'D360_CONFIRMATION_REQUIRED');
    await TransformRun.run(['-o', org.username, '-n', 'OrdersTransform', '--no-prompt', '--json']);
    await TransformReport.run(['-o', org.username, '-n', 'OrdersTransform', '--history', '--json']);
    await TransformScheduleDisplay.run(['-o', org.username, '-n', 'OrdersTransform', '--json']);
    await TransformScheduleSet.run([
      '-o',
      org.username,
      '-n',
      'OrdersTransform',
      '--cron',
      '0 0 * * *',
      '--no-prompt',
      '--json',
    ]);
    await TransformCancel.run(['-o', org.username, '-n', 'OrdersTransform', '--no-prompt', '--json']);
    expect(
      requests.some(({ method, url }) => method === 'PUT' && url?.endsWith('/data-transforms/OrdersTransform'))
    ).to.equal(true);
    expect(requests.some(({ method, url }) => method === 'GET' && url?.endsWith('/run-history'))).to.equal(true);
    expect(requests.some(({ method, url }) => method === 'PUT' && url?.endsWith('/schedule'))).to.equal(true);
  });
});
