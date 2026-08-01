#!/usr/bin/env node

import { spawn } from 'node:child_process';

const yarn = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';

const gates = [
  'secrets:scan',
  'public:check:history',
  'audit:production',
  'clean',
  'compile',
  'contract:check',
  'build',
  'help:smoke',
  'lint',
  'format:check',
  'test',
  'test:eval',
  'test:coverage',
  'test:security',
  'test:perf',
  'test:package',
];

const run = (script) =>
  new Promise((done, reject) => {
    const child = spawn(yarn, ['run', script], { env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (exitCode) => {
      if (exitCode === 0) done();
      else reject(new Error(`Release gate "${script}" exited ${exitCode ?? 1}.`));
    });
  });

for (const gate of gates) await run(gate);
