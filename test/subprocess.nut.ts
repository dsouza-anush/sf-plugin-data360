import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'chai';
import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { buildMockServer } from './mock/server.js';

const ansiPattern = new RegExp(String.raw`\u001B\[`, 'u');

const root = resolve(import.meta.dirname, '..');

describe('installed-command subprocess NUT', () => {
  let session: TestSession;
  let address: string;
  let server: Awaited<ReturnType<typeof buildMockServer>>;
  const originalExecutable = process.env.TESTKIT_EXECUTABLE_PATH;

  before(async () => {
    process.env.TESTKIT_EXECUTABLE_PATH = resolve(root, 'bin', 'run.js');
    server = await buildMockServer();
    address = await server.listen({ host: '127.0.0.1', port: 0 });
    session = await TestSession.create();
  });

  after(async () => {
    await server.close();
    await session.clean();
    if (originalExecutable === undefined) delete process.env.TESTKIT_EXECUTABLE_PATH;
    else process.env.TESTKIT_EXECUTABLE_PATH = originalExecutable;
  });

  const environment = (): NodeJS.ProcessEnv => ({
    ...process.env,
    CI: '1',
    D360_NUT_MOCK_URL: address,
    HOME: session.homeDir,
    NODE_ENV: 'test',
    NODE_OPTIONS: `--import=${pathToFileURL(resolve(root, 'test', 'nut', 'mock-org-preload.mjs')).href}`,
    SF_AUTOUPDATE_DISABLE: 'true',
    SF_DISABLE_TELEMETRY: 'true',
    SF_NO_COLOR: '1',
    USERPROFILE: session.homeDir,
  });

  it('runs a complete Query command through a child sf-plugin process and the HTTP mock boundary', async () => {
    const execution = await execCmd<{
      queryId: string;
      status: string;
      done: boolean;
      rowCount: number;
      rows: unknown[][];
    }>('data360 query --target-org subprocess-nut@example.invalid --query "select 1" --no-prompt --json', {
      env: environment(),
      timeout: 10_000,
      async: true,
      ensureExitCode: 0,
    });

    expect(execution.jsonError).to.equal(undefined);
    expect(execution.jsonOutput?.status).to.equal(0);
    expect(execution.jsonOutput?.warnings).to.be.an('array');
    expect(execution.jsonOutput?.result).to.deep.include({ status: 'ResultsProduced', done: true, rowCount: 1 });
    expect(execution.jsonOutput?.result.rows).to.have.length(1);
    expect(execution.shellOutput.stderr ?? '').to.equal('');
    expect(execution.shellOutput.stdout).to.not.match(ansiPattern);
  });

  it('preserves parser exit 2 and a quiet stdout boundary in a child process', () => {
    const execution = execCmd('data360 query --criteria-unknown-flag', {
      ensureExitCode: 2,
      env: environment(),
      timeout: 10_000,
    });

    expect(execution.shellOutput.code).to.equal(2);
    expect(execution.shellOutput.stdout).to.equal('');
    expect(execution.shellOutput.stderr).to.include('--criteria-unknown-flag');
    expect(execution.shellOutput.stderr).to.not.match(ansiPattern);
  });
});
