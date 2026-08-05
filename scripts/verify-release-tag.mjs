#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8');
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const expectedTag = `v${manifest.version}`;

if (!tag) throw new Error(`Pass ${expectedTag} or set GITHUB_REF_NAME.`);
if (tag !== expectedTag) throw new Error(`Release tag ${tag} does not match package version ${manifest.version}.`);

const escapedVersion = manifest.version.replaceAll('.', '\\.');
const releaseHeading = new RegExp(`^## ${escapedVersion} - (\\d{4}-\\d{2}-\\d{2})$`, 'mu');
if (!releaseHeading.test(changelog)) {
  throw new Error(`CHANGELOG.md must contain a dated \"## ${manifest.version} - YYYY-MM-DD\" release heading.`);
}

process.stdout.write(`PASS release identity (${expectedTag}).\n`);
