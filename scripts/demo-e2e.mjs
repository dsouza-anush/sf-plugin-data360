import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mocha = fileURLToPath(new URL('../node_modules/mocha/bin/mocha.js', import.meta.url));
const files = [
  'test/query.test.ts',
  'test/p2.test.ts',
  'test/ingest.test.ts',
  'test/p4-remaining.nut.test.ts',
  'test/p5-identity-resolution.test.ts',
  'test/p5-calculated-insight.test.ts',
  'test/p5-segment.test.ts',
  'test/p5-activation.test.ts',
  'test/p5-search-index.test.ts',
  'test/p5-data-graph.test.ts',
  'test/p5-profile.test.ts',
  'test/p5-query-search.test.ts',
];
const env = {
  ...process.env,
  CI: '1',
  NODE_ENV: 'test',
  SF_NO_COLOR: '1',
};
delete env.D360_LIVE_ORG;
delete env.D360_LIVE_BILLABLE;
delete env.TESTKIT_AUTH_URL;

const child = spawn(
  process.execPath,
  ['--loader', 'ts-node/esm', mocha, '--no-config', '--timeout', '10000', ...files],
  { cwd: root, env, stdio: 'inherit' }
);
const [code, signal] = await new Promise((resolve) => child.once('exit', (...result) => resolve(result)));
if (signal) throw new Error(`Mock demo terminated by ${signal}.`);
if (code !== 0) process.exitCode = code ?? 1;
else
  process.stdout.write(
    'PASS unattended P1-P5 mock demo (JSON/no-prompt paths; no live credentials or billable calls).\n'
  );
