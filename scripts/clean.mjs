#!/usr/bin/env node

import { readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await Promise.all([
  rm(resolve(root, 'lib'), { force: true, recursive: true }),
  rm(resolve(root, 'coverage'), { force: true, recursive: true }),
  ...(await readdir(root))
    .filter((entry) => entry.endsWith('.tsbuildinfo'))
    .map((entry) => rm(resolve(root, entry), { force: true })),
]);
