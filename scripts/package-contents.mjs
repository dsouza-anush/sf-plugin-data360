#!/usr/bin/env node

import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exactFiles = new Set([
  'ARCHITECTURE.md',
  'CHANGELOG.md',
  'LICENSE',
  'NOTICE',
  'README.md',
  'SECURITY.md',
  'VERIFICATION.md',
  'command-snapshot.json',
  'docs/API_COVERAGE.md',
  'docs/CLI_CONTRACT.md',
  'docs/CODE_EXTENSIONS.md',
  'docs/COMMAND_REFERENCE.md',
  'docs/EXTERNAL_CLIENT_APP.md',
  'docs/GETTING_STARTED.md',
  'docs/INSTALLATION.md',
  'docs/REPL_CHECKLIST.md',
  'docs/RELEASE.md',
  'npm-shrinkwrap.json',
  'oclif.lock',
  'oclif.manifest.json',
  'package.json',
]);
const allowedPrefixes = ['assets/', 'bin/', 'examples/', 'lib/', 'messages/', 'schemas/'];
const forbiddenFiles = new Set(['.env.live.example', 'CONTRIBUTING.md', 'LIVE_TESTING.md', 'TESTING.md']);
const forbiddenPrefixes = ['docs/evidence/', 'docs/internal/', 'internal/', 'references/', 'scripts/', 'src/', 'test/'];
const requiredFiles = [
  'ARCHITECTURE.md',
  'CHANGELOG.md',
  'LICENSE',
  'NOTICE',
  'README.md',
  'SECURITY.md',
  'VERIFICATION.md',
  'assets/README.md',
  'assets/data360-mark.svg',
  'bin/run.js',
  'command-snapshot.json',
  'docs/API_COVERAGE.md',
  'docs/CLI_CONTRACT.md',
  'docs/CODE_EXTENSIONS.md',
  'docs/COMMAND_REFERENCE.md',
  'docs/EXTERNAL_CLIENT_APP.md',
  'docs/GETTING_STARTED.md',
  'docs/INSTALLATION.md',
  'docs/REPL_CHECKLIST.md',
  'docs/RELEASE.md',
  'examples/README.md',
  'lib/index.js',
  'messages/data360.query.md',
  'npm-shrinkwrap.json',
  'oclif.lock',
  'oclif.manifest.json',
  'package.json',
  'schemas/data360.query.json',
  'schemas/error-codes.json',
];
const forbiddenMarkers = [
  { label: 'dedicated org alias', pattern: /\bd360-(?:live|test)\b/iu },
  { label: 'dedicated ECA API name', pattern: /\bD360CliVerify_\d+\b/u },
  { label: 'dedicated source name', pattern: /\bLive_Verify_Ingest_\d+\b/u },
  { label: 'internal source narrative', pattern: /\b(?:Slack|Gmail|history-clean|force-update)\b/iu },
  { label: 'Salesforce instance identifier', pattern: /\bUSA\d{2,}\b/u },
];

const text = (buffer) => buffer.toString('utf8').replaceAll('\0', '').trim();
const octal = (buffer) => Number.parseInt(text(buffer).replaceAll(/[^0-7]/gu, '') || '0', 8);

const parsePax = (buffer) => {
  const values = {};
  let offset = 0;
  while (offset < buffer.length) {
    const separator = buffer.indexOf(0x20, offset);
    if (separator < 0) break;
    const length = Number.parseInt(buffer.subarray(offset, separator).toString('ascii'), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = buffer
      .subarray(separator + 1, offset + length)
      .toString('utf8')
      .replace(/\n$/u, '');
    const equals = record.indexOf('=');
    if (equals > 0) values[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return values;
};

export const readTarEntries = async (tarball) => {
  const archive = gunzipSync(await readFile(tarball));
  const entries = [];
  let offset = 0;
  let longName;
  let pax = {};
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = octal(header.subarray(124, 136));
    const mode = octal(header.subarray(100, 108));
    const type = String.fromCharCode(header[156] || 0x30);
    const prefix = text(header.subarray(345, 500));
    const headerName = `${prefix ? `${prefix}/` : ''}${text(header.subarray(0, 100))}`;
    const bodyStart = offset + 512;
    const body = archive.subarray(bodyStart, bodyStart + size);
    offset = bodyStart + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      pax = { ...pax, ...parsePax(body) };
      continue;
    }
    if (type === 'L') {
      longName = text(body);
      continue;
    }
    const archivePath = pax.path ?? longName ?? headerName;
    pax = {};
    longName = undefined;
    const path = archivePath
      .replace(/^\.\/package\//u, '')
      .replace(/^package\//u, '')
      .replace(/^\.\//u, '');
    if (!path || path === 'package' || path.endsWith('/') || type === '5') continue;
    entries.push({ body, mode, path, size, type });
  }
  return entries;
};

export const assertPackageContents = async (tarball) => {
  const entries = await readTarEntries(tarball);
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const paths = new Set(entries.map(({ path }) => path));
  const forbidden = [...paths].filter(
    (path) => forbiddenFiles.has(path) || forbiddenPrefixes.some((prefix) => path.startsWith(prefix))
  );
  if (forbidden.length > 0) throw new Error(`Package contains forbidden paths: ${forbidden.sort().join(', ')}`);
  const unexpected = [...paths].filter(
    (path) => !exactFiles.has(path) && !allowedPrefixes.some((prefix) => path.startsWith(prefix))
  );
  if (unexpected.length > 0) throw new Error(`Package contains unexpected paths: ${unexpected.sort().join(', ')}`);
  const missing = requiredFiles.filter((path) => !paths.has(path));
  if (missing.length > 0) throw new Error(`Package is missing required paths: ${missing.join(', ')}`);
  const manifest = JSON.parse(entriesByPath.get('package.json').body.toString('utf8'));
  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) {
    if (manifest.scripts?.[lifecycle]) throw new Error(`Package defines forbidden lifecycle script ${lifecycle}.`);
  }
  const shrinkwrap = JSON.parse(entriesByPath.get('npm-shrinkwrap.json').body.toString('utf8'));
  if (shrinkwrap.lockfileVersion !== 3 || shrinkwrap.name !== manifest.name || shrinkwrap.version !== manifest.version)
    throw new Error('Package shrinkwrap identity or lockfile version does not match package.json.');
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (shrinkwrap.packages?.['']?.dependencies?.[name] !== range || !shrinkwrap.packages?.[`node_modules/${name}`])
      throw new Error(`Package shrinkwrap does not lock runtime dependency ${name}.`);
  }
  for (const entry of entries) {
    const permissions = entry.mode & 0o777;
    const expectedMode = entry.path.startsWith('bin/') ? 0o755 : 0o644;
    if (permissions !== expectedMode) {
      throw new Error(
        `Package path ${entry.path} has mode ${permissions.toString(8)}; expected ${expectedMode.toString(8)}.`
      );
    }
    if (entry.size > 8 * 1024 * 1024) continue;
    const contents = entry.body.toString('utf8');
    for (const marker of forbiddenMarkers) {
      if (marker.pattern.test(contents)) throw new Error(`Package path ${entry.path} contains ${marker.label}.`);
    }
  }
  return { entries: entries.length, paths: [...paths].sort() };
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const argument = process.argv[2];
  if (!argument) throw new Error('Usage: node scripts/package-contents.mjs <package.tgz>');
  const tarball = isAbsolute(argument) ? argument : resolve(argument);
  const result = await assertPackageContents(tarball);
  process.stdout.write(`PASS package content boundary (${result.entries} files).\n`);
}
