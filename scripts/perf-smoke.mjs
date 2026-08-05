import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const bin = new URL('../bin/run.js', import.meta.url).pathname;
const samples = [];

for (let index = 0; index < 20; index += 1) {
  const started = performance.now();
  await execute(process.execPath, [bin, 'data360', '--help']);
  samples.push(performance.now() - started);
}

samples.sort((left, right) => left - right);
const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
const budget = 400;
const summary = `Data 360 help cold-start p95: ${p95.toFixed(1)} ms (budget ${budget} ms).`;
if (p95 > budget && process.env.D360_PERF_STRICT === '1') throw new Error(summary);
process.stdout.write(`${p95 <= budget ? 'PASS' : 'WARN'} ${summary}\n`);
