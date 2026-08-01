#!/usr/bin/env node

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimizeLiveFixturePayload } from './live-verify-all.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const liveDirectory = resolve(root, 'test', 'fixtures', 'live');
let changed = 0;

for (const entry of await readdir(liveDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
  const path = resolve(liveDirectory, entry.name);
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  if (
    fixture?.__fixture?.source !== 'live-scrubbed' ||
    fixture?.__fixture?.outcome === 'error' ||
    typeof fixture?.__fixture?.command !== 'string'
  )
    continue;
  const minimized = minimizeLiveFixturePayload(fixture.__fixture.command, fixture);
  const before = `${JSON.stringify(fixture, undefined, 2)}\n`;
  const after = `${JSON.stringify(minimized, undefined, 2)}\n`;
  if (before === after) continue;
  await writeFile(path, after);
  changed += 1;
}

process.stdout.write(`Minimized ${changed} record-bearing live fixtures.\n`);
