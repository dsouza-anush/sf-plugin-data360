#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const forbiddenPaths = new Set([
  '.gitmodules',
  'docs/AGENT-TESTBED.md',
  'docs/CODE_REVIEW.md',
  'docs/COMMANDS.md',
  'docs/IMPLEMENTATION.md',
  'docs/PLAN.md',
  'docs/TESTPLAN.md',
]);
const forbiddenPrefixes = [
  'docs/evidence/',
  'docs/internal/',
  'internal/',
  'references/',
  'testbed/reports/',
  'testbed/sessions/',
];
const privateMarkers = [
  {
    label: 'internal collaboration reference',
    pattern: /\b(?:Slack channel|Quip document|Gmail thread)\b/iu,
    gitPattern: '(Slack channel|Quip document|Gmail thread)',
  },
  {
    label: 'named internal collaboration reference',
    pattern:
      /(?:#(?:platform-cli-collaboration|data360-headless-testing|jag-fde-ai-sharelab|sf-skills-onboarding-support)\b|quickstart-quip)/iu,
    gitPattern:
      '(#(platform-cli-collaboration|data360-headless-testing|jag-fde-ai-sharelab|sf-skills-onboarding-support)|quickstart-quip)',
  },
  {
    label: 'internal repository hostname',
    pattern: /\bgit\.soma\.salesforce\.com\b/iu,
    gitPattern: 'git\\.soma\\.salesforce\\.com',
  },
  { label: 'internal org-farm reference', pattern: /\borgfarm\b/iu, gitPattern: 'orgfarm' },
  { label: 'private Rosetta scenario', pattern: /\brosetta\b/iu, gitPattern: 'rosetta' },
  {
    label: 'private NTO scenario',
    pattern: /\b(?:NTO|Northern Trail Outfitters)\b/iu,
    gitPattern: '\\<(NTO|Northern Trail Outfitters)\\>',
  },
  {
    label: 'internal-only directive',
    pattern:
      /\b(?:internal[- ]only (?:content|data|directive|document|file|material|note|report|source)|do not open source|not for public release)\b/iu,
    gitPattern:
      '(internal[- ]only (content|data|directive|document|file|material|note|report|source)|do not open source|not for public release)',
  },
];
const textExtensions = new Set([
  '',
  '.cjs',
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.jsonl',
  '.md',
  '.mjs',
  '.mts',
  '.sh',
  '.ts',
  '.txt',
  '.yaml',
  '.yml',
]);
const markerScanExclusions = new Set([
  'scripts/package-contents.mjs',
  'scripts/public-source-check.mjs',
  'scripts/release-secret-scan.mjs',
]);

const git = (root, args) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });

const repositoryFiles = (root) =>
  git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
    .filter((path) => existsSync(resolve(root, path)));

const indexFiles = (root) => git(root, ['ls-files', '-z', '--cached']).split('\0').filter(Boolean);

const boundaryConfigurationViolations = async (root) => {
  const violations = [];
  try {
    git(root, ['check-ignore', '--no-index', '--quiet', 'internal/.public-source-boundary']);
  } catch {
    violations.push('.gitignore: internal/ is not ignored');
  }
  const npmignore = await readFile(resolve(root, '.npmignore'), 'utf8').catch(() => '');
  if (!/^\/?internal\/$/mu.test(npmignore)) violations.push('.npmignore: internal/ is not excluded');
  return violations;
};

const forbiddenPathReason = (path) => {
  if (forbiddenPaths.has(path)) return 'reserved private path';
  const prefix = forbiddenPrefixes.find((candidate) => path === candidate.slice(0, -1) || path.startsWith(candidate));
  return prefix ? `reserved private prefix ${prefix}` : undefined;
};

const scanCurrentFiles = async (root, files) => {
  const violations = [];
  for (const path of files) {
    const pathReason = forbiddenPathReason(path);
    if (pathReason) violations.push(`${path}: ${pathReason}`);
    if (pathReason || markerScanExclusions.has(path) || !textExtensions.has(extname(path).toLowerCase())) continue;
    let contents;
    try {
      contents = await readFile(resolve(root, path), 'utf8');
    } catch {
      continue;
    }
    if (contents.includes('\0')) continue;
    for (const marker of privateMarkers) {
      if (marker.pattern.test(contents)) violations.push(`${path}: ${marker.label}`);
      marker.pattern.lastIndex = 0;
    }
  }
  return violations;
};

const scanIndexFiles = (root, files) => {
  const violations = [];
  for (const path of files) {
    const pathReason = forbiddenPathReason(path);
    if (pathReason) violations.push(`index:${path}: ${pathReason}`);
    if (pathReason || markerScanExclusions.has(path) || !textExtensions.has(extname(path).toLowerCase())) continue;
    let contents;
    try {
      contents = git(root, ['show', `:${path}`]);
    } catch {
      continue;
    }
    if (contents.includes('\0')) continue;
    for (const marker of privateMarkers) {
      if (marker.pattern.test(contents)) violations.push(`index:${path}: ${marker.label}`);
      marker.pattern.lastIndex = 0;
    }
  }
  return violations;
};

const scanHistory = (root, ref) => {
  const violations = [];
  const paths = git(root, ['log', '--format=', '--name-only', ref]).split(/\r?\n/u).filter(Boolean);
  for (const path of paths) {
    const reason = forbiddenPathReason(path);
    if (reason) violations.push(`${ref}:${path}: ${reason}`);
  }
  for (const marker of privateMarkers) {
    let matchingPaths;
    try {
      matchingPaths = git(root, [
        'log',
        '--regexp-ignore-case',
        '-G',
        marker.gitPattern,
        '--format=',
        '--name-only',
        ref,
        '--',
      ])
        .split(/\r?\n/u)
        .filter(Boolean);
    } catch {
      continue;
    }
    for (const path of matchingPaths) {
      if (markerScanExclusions.has(path) || !textExtensions.has(extname(path).toLowerCase())) continue;
      violations.push(`${ref}:${path}: ${marker.label}`);
    }
  }
  return violations;
};

export const checkPublicSource = async ({ root = defaultRoot, historyRef } = {}) => {
  const repositoryRoot = resolve(root);
  const files = repositoryFiles(repositoryRoot);
  const stagedFiles = indexFiles(repositoryRoot);
  const violations = [
    ...(await boundaryConfigurationViolations(repositoryRoot)),
    ...(await scanCurrentFiles(repositoryRoot, files)),
    ...scanIndexFiles(repositoryRoot, stagedFiles),
  ];
  if (historyRef) violations.push(...scanHistory(repositoryRoot, historyRef));
  return { files: files.length, historyRef, violations: [...new Set(violations)].sort() };
};

const parseArguments = (values) => {
  let root = defaultRoot;
  let historyRef;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === '--root') root = resolve(values[++index] ?? '');
    else if (values[index] === '--history') historyRef = values[++index];
    else throw new Error(`Unknown option: ${values[index]}`);
  }
  return { root, historyRef };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const result = await checkPublicSource(options);
  if (result.violations.length > 0) {
    process.stderr.write(`FAIL public source boundary (${result.violations.length} violation(s))\n`);
    process.stderr.write(`${result.violations.map((violation) => `- ${violation}`).join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `PASS public source boundary (${result.files} files${result.historyRef ? `; history ${result.historyRef}` : ''}).\n`
    );
  }
}
