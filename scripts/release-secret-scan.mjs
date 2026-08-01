#!/usr/bin/env node

import { lstat, readFile, readlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maximumGitOutputBytes = 512 * 1024 * 1024;

const placeholderLiterals = new Set([
  '[REDACTED]',
  'also-secret',
  'Bearer tenant-jwt-secret',
  'core-token-secret',
  'fresh-jwt',
  'fresh-token',
  'jwt-1',
  'jwt-2',
  'jwt-3',
  'legacy-token',
  'opaque-api-key',
  'opaque-client-secret',
  'opaque-password',
  'opaque-private-key',
  'production-jwt-secret',
  'proxy-secret',
  'recovered-token',
  'secret',
  'secret-core',
  'secret-refresh',
  'secret-session',
  'secret-tenant',
  'secret-token',
  'stale-token',
  'super-secret',
  'synthetic-core-token',
  'synthetic-tenant-token',
  'synthetic-token',
  'tenant-jwt-secret',
  'test-token',
  'i@izs.me',
]);
const syntheticFixturePaths = new Set(['test/testbed-redactor.test.ts', 'test/testbed.test.ts', 'test/trace.test.ts']);
const syntheticFixtureMarker = 'secret-scan: synthetic-fixture';
const placeholderEmailDomains = new Set(['example.com', 'example.invalid', 'example.test', 'proxy.invalid']);
const placeholderSalesforceHosts = new Set([
  'mock.c360a.salesforce.com',
  'returned.c360a.salesforce.com',
  'tenant.c360a.salesforce.com',
]);
const placeholderSalesforceIds = new Set(['005000000000001', '00D000000000001']);

const detectors = [
  {
    label: 'Data 360 tenant identifier',
    pattern: /\ba360\/(?:prod|test)\/[A-Za-z0-9_-]{8,}\b/giu,
  },
  {
    label: 'Salesforce access token or session ID',
    pattern: /\b00D[A-Za-z0-9]{12,15}(?:!|%21)[A-Za-z0-9._~+%/=-]{8,}\b/giu,
  },
  {
    label: 'Salesforce consumer key',
    pattern: /\b3MVG9[A-Za-z0-9._-]{20,}\b/gu,
  },
  {
    label: 'Salesforce org ID',
    pattern: /(?<![A-Za-z0-9])00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?(?![A-Za-z0-9])/gu,
  },
  {
    label: 'Salesforce user ID',
    pattern: /(?<![A-Za-z0-9])005[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?(?![A-Za-z0-9])/gu,
  },
  {
    label: 'Salesforce auth URL',
    pattern: /\bforce:\/\/[^\s"'`]+/giu,
  },
  {
    label: 'Salesforce frontdoor session URL',
    pattern: /https?:\/\/[^\s"'`]+\/secur\/frontdoor\.jsp\?[^#\s"'`]*\b(?:sid|otp)=[^&#\s"'`]+/giu,
  },
  {
    label: 'Salesforce org hostname',
    pattern:
      /\b(?:https?:\/\/)?(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:cloudforce\.com|documentforce\.com|my\.salesforce\.com|my\.site\.com|salesforce-experience\.com|salesforce-hyperforce\.com|salesforce-sites\.com|salesforce-setup\.com|visualforce\.com)|(?:[A-Za-z0-9-]+\.)+force\.com|[A-Za-z]{2,5}\d{1,4}[A-Za-z]?\.salesforce\.com)\b/giu,
  },
  {
    label: 'Data 360 tenant hostname',
    pattern: /\b(?:https?:\/\/)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.c360a\.salesforce\.com\b/giu,
  },
  {
    label: 'bearer credential',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gu,
    value: (match) => match[0].replace(/^Bearer\s+/u, ''),
  },
  {
    label: 'basic credential',
    pattern: /\bBasic\s+[A-Za-z0-9+/]{8,}={0,2}/gu,
    value: (match) => match[0].replace(/^Basic\s+/u, ''),
  },
  {
    label: 'JWT credential',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
  },
  {
    label: 'private key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/gu,
  },
  {
    label: 'credentialed URL',
    pattern: /\bhttps?:\/\/[^\s/@:"'`]+:[^\s/@"'`]+@[^\s/"'`]+/giu,
  },
  {
    label: 'email address or Salesforce username',
    pattern: /(?<!:)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  },
  {
    label: 'credential-valued field',
    pattern:
      /\b(?:access[_-]?token|api[_-]?key|authorization|bearer|client[_-]?secret|consumer[_-]?key|core[_-]?token|id[_-]?token|jwt|password|private[_-]?key|refresh[_-]?token|secret|session[_-]?id|sfdx[_-]?auth[_-]?url|subject[_-]?token|token)\b\s*[:=]\s*(?:"([^"\r\n]{3,})"|'([^'\r\n]{3,})')/giu,
    value: (match) => match[1] ?? match[2] ?? '',
  },
  {
    label: 'credential-valued field',
    pattern:
      /^\s*(?:export\s+)?(?:access[_-]?token|api[_-]?key|authorization|client[_-]?secret|consumer[_-]?key|core[_-]?token|id[_-]?token|jwt|password|private[_-]?key|refresh[_-]?token|secret|session[_-]?id|sfdx[_-]?auth[_-]?url|subject[_-]?token|testkit[_-]?auth[_-]?url|token)\s*[:=]\s*([^\s#"',;[\]{}]{3,})\s*$/gimu,
    value: (match) => match[1] ?? '',
  },
];

const isTemplatePlaceholder = (value) =>
  /^(?:<[^>\r\n]+>|\$[A-Z][A-Z0-9_]*|\$\{[A-Z][A-Z0-9_]*\}|\[REDACTED\])$/u.test(value) ||
  /^force:\/\/(?:<[^>\r\n]+>:){1,2}<[^>\r\n]+>@(?:<[^>\r\n]+>|(?:login|test)\.salesforce\.com)$/iu.test(value);

const hostnameFromCandidate = (candidate) => {
  try {
    return new URL(candidate.includes('://') ? candidate : `https://${candidate}`).hostname.toLowerCase();
  } catch {
    return candidate
      .toLowerCase()
      .replace(/^https?:\/\//u, '')
      .split('/')[0];
  }
};

const isAllowedPlaceholder = (label, candidate) => {
  const value = candidate.trim();
  if (placeholderLiterals.has(value) || isTemplatePlaceholder(value)) return true;

  if (label === 'Salesforce org ID' || label === 'Salesforce user ID') return placeholderSalesforceIds.has(value);

  if (label === 'email address or Salesforce username') {
    const domain = value.slice(value.lastIndexOf('@') + 1).toLowerCase();
    return placeholderEmailDomains.has(domain);
  }

  if (label === 'Salesforce org hostname' || label === 'Data 360 tenant hostname') {
    return placeholderSalesforceHosts.has(hostnameFromCandidate(value));
  }

  if (label === 'credentialed URL') {
    if (/^https?:\/\/(?:proxy-user:proxy-secret|user:pass)@/iu.test(value)) return true;
    try {
      const url = new URL(value);
      return (
        (url.username === 'user' && url.password === 'pass') ||
        (url.username === 'proxy-user' && url.password === 'proxy-secret')
      );
    } catch {
      return false;
    }
  }

  if (label === 'Salesforce frontdoor session URL') {
    try {
      const url = new URL(value);
      const session = url.searchParams.get('sid') ?? url.searchParams.get('otp');
      return (
        /^(?:\[REDACTED\]|REDACTED_[A-Z0-9_]+)$/u.test(session ?? '') ||
        placeholderEmailDomains.has(url.hostname.toLowerCase())
      );
    } catch {
      return false;
    }
  }

  return false;
};

const lineStartsFor = (contents) => {
  const starts = [0];
  for (let index = contents.indexOf('\n'); index >= 0; index = contents.indexOf('\n', index + 1))
    starts.push(index + 1);
  return starts;
};

const lineAt = (starts, offset) => {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle;
  }
  return low + 1;
};

export const findSensitiveValues = (contents) => {
  const starts = lineStartsFor(contents);
  const findings = [];
  const seen = new Set();

  for (const detector of detectors) {
    detector.pattern.lastIndex = 0;
    for (const match of contents.matchAll(detector.pattern)) {
      const candidate = detector.value ? detector.value(match) : match[0];
      if (detector.label === 'credential-valued field' && /^id[_-]?token\s*:\s*write$/iu.test(match[0].trim()))
        continue;
      if (isAllowedPlaceholder(detector.label, candidate)) continue;
      const line = lineAt(starts, match.index ?? 0);
      const key = `${detector.label}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ label: detector.label, line });
    }
  }

  return findings;
};

const git = (root, gitBinary, operation, args, options = {}) => {
  const result = spawnSync(gitBinary, ['-C', root, ...args], {
    encoding: null,
    input: options.input,
    maxBuffer: maximumGitOutputBytes,
    windowsHide: true,
  });
  if (result.error) throw new Error(`Release secret scan could not run Git during ${operation}.`);
  if (result.status !== 0) {
    throw new Error(`Release secret scan Git ${operation} failed with exit code ${result.status ?? 1}.`);
  }
  return result.stdout;
};

const parseNulPaths = (buffer) => buffer.toString('utf8').split('\0').filter(Boolean);

const scanContents = (contents, source, path, findings) => {
  const lines = syntheticFixturePaths.has(path) ? contents.split(/\r?\n/u) : [];
  for (const finding of findSensitiveValues(contents)) {
    if (lines[finding.line - 1]?.includes(syntheticFixtureMarker)) continue;
    findings.push({ ...finding, path, source });
  }
};

const scanWorkingTree = async (root, gitBinary, findings) => {
  const paths = parseNulPaths(
    git(root, gitBinary, 'tracked-file enumeration', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  );
  let scanned = 0;
  for (const trackedPath of paths) {
    const absolutePath = resolve(root, trackedPath);
    let metadata;
    try {
      metadata = await lstat(absolutePath);
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') continue;
      throw new Error(`Release secret scan could not read a tracked working-tree path.`);
    }
    if (metadata.isDirectory()) continue;
    let contents;
    try {
      contents = metadata.isSymbolicLink()
        ? await readlink(absolutePath)
        : (await readFile(absolutePath)).toString('utf8');
    } catch {
      throw new Error(`Release secret scan could not read a tracked working-tree file.`);
    }
    scanContents(contents, 'working tree', relative(root, absolutePath), findings);
    scanned += 1;
  }
  return scanned;
};

const parseReachableObjects = (buffer) => {
  const paths = new Map();
  const objectIds = [];
  for (const line of buffer.toString('utf8').split(/\r?\n/u)) {
    if (!line) continue;
    const separator = line.indexOf(' ');
    const objectId = separator < 0 ? line : line.slice(0, separator);
    if (!/^[a-f0-9]{40,64}$/u.test(objectId)) throw new Error('Release secret scan received invalid Git object data.');
    objectIds.push(objectId);
    if (separator >= 0) paths.set(objectId, line.slice(separator + 1));
  }
  return { objectIds, paths };
};

const blobObjectIds = (root, gitBinary, objectIds) => {
  if (objectIds.length === 0) return [];
  const input = Buffer.from(`${objectIds.join('\n')}\n`);
  const output = git(root, gitBinary, 'object inspection', ['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
    input,
  }).toString('utf8');
  const blobs = [];
  for (const line of output.split(/\r?\n/u)) {
    if (!line) continue;
    const [objectId, type] = line.split(' ');
    if (!/^[a-f0-9]{40,64}$/u.test(objectId ?? '') || !type) {
      throw new Error('Release secret scan received invalid Git object metadata.');
    }
    if (!['blob', 'commit', 'tag', 'tree'].includes(type)) {
      throw new Error('Release secret scan could not read every reachable Git object.');
    }
    if (type === 'blob') blobs.push(objectId);
  }
  return blobs;
};

const parseBlobBatch = (buffer, expectedObjectIds) => {
  const blobs = [];
  let offset = 0;
  for (const expectedObjectId of expectedObjectIds) {
    const headerEnd = buffer.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error('Release secret scan received a truncated Git blob batch.');
    const header = buffer.subarray(offset, headerEnd).toString('utf8');
    const [objectId, type, sizeText] = header.split(' ');
    const size = Number(sizeText);
    if (objectId !== expectedObjectId || type !== 'blob' || !Number.isSafeInteger(size) || size < 0) {
      throw new Error('Release secret scan received invalid Git blob data.');
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= buffer.length || buffer[contentEnd] !== 0x0a) {
      throw new Error('Release secret scan received a truncated Git blob.');
    }
    blobs.push(buffer.subarray(contentStart, contentEnd).toString('utf8'));
    offset = contentEnd + 1;
  }
  if (offset !== buffer.length) throw new Error('Release secret scan received unexpected Git blob data.');
  return blobs;
};

const scanIndex = (root, gitBinary, findings) => {
  const entries = parseNulPaths(git(root, gitBinary, 'index enumeration', ['ls-files', '--stage', '-z']));
  const paths = new Map();
  const objectIds = [];
  for (const entry of entries) {
    const separator = entry.indexOf('\t');
    const [mode, objectId, stage] = entry.slice(0, separator).split(' ');
    const path = entry.slice(separator + 1);
    if (
      separator < 0 ||
      !/^(?:100644|100755|120000)$/u.test(mode ?? '') ||
      !/^[a-f0-9]{40,64}$/u.test(objectId ?? '') ||
      !/^[0-3]$/u.test(stage ?? '') ||
      !path
    ) {
      if (mode === '160000' && /^[a-f0-9]{40,64}$/u.test(objectId ?? '')) continue;
      throw new Error('Release secret scan received invalid Git index data.');
    }
    if (!paths.has(objectId)) objectIds.push(objectId);
    paths.set(objectId, path);
  }
  if (objectIds.length === 0) return 0;
  const batch = git(root, gitBinary, 'index blob inspection', ['cat-file', '--batch'], {
    input: Buffer.from(`${objectIds.join('\n')}\n`),
  });
  const contents = parseBlobBatch(batch, objectIds);
  contents.forEach((content, index) => scanContents(content, 'Git index', paths.get(objectIds[index]), findings));
  return objectIds.length;
};

const validateRef = (ref) => {
  if (!ref || ref.startsWith('-') || ref.length > 200 || !/^[A-Za-z0-9._/@{}~^:+-]+$/u.test(ref)) {
    throw new Error('Release secret scan ref is invalid.');
  }
};

const scanHistory = (root, ref, gitBinary, findings) => {
  validateRef(ref);
  const commit = git(root, gitBinary, 'ref resolution', ['rev-parse', '--verify', `${ref}^{commit}`])
    .toString('utf8')
    .trim();
  if (!/^[a-f0-9]{40,64}$/u.test(commit)) throw new Error('Release secret scan could not resolve the requested ref.');

  const { objectIds, paths } = parseReachableObjects(
    git(root, gitBinary, 'reachable-object enumeration', ['rev-list', '--objects', commit])
  );
  const blobIds = blobObjectIds(root, gitBinary, objectIds);
  if (blobIds.length === 0) return 0;
  const batch = git(root, gitBinary, 'blob inspection', ['cat-file', '--batch'], {
    input: Buffer.from(`${blobIds.join('\n')}\n`),
  });
  const contents = parseBlobBatch(batch, blobIds);
  contents.forEach((content, index) => {
    const objectId = blobIds[index];
    scanContents(content, 'reachable history', paths.get(objectId) || '(unnamed historical blob)', findings);
  });
  return blobIds.length;
};

export const scanRepository = async ({ root = repositoryRoot, ref = 'HEAD', gitBinary = 'git' } = {}) => {
  const absoluteRoot = resolve(root);
  const findings = [];
  const workingTreeFiles = await scanWorkingTree(absoluteRoot, gitBinary, findings);
  const indexBlobs = scanIndex(absoluteRoot, gitBinary, findings);
  const historicalBlobs = scanHistory(absoluteRoot, ref, gitBinary, findings);
  return { findings, historicalBlobs, indexBlobs, ref, workingTreeFiles };
};

const printablePath = (path = '(unknown path)') =>
  findSensitiveValues(path).length > 0
    ? '[credential-shaped filename omitted]'
    : path.replace(/[\u0000-\u001F\u007F]/gu, '?');

export const formatFindings = (findings) =>
  findings.map(({ label, line, path, source }) => `- ${source}: ${printablePath(path)}:${line} (${label})`).join('\n');

const parseArguments = (arguments_) => {
  let ref = process.env.D360_SECRET_SCAN_REF || 'HEAD';
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] === '--ref' && arguments_[index + 1]) {
      ref = arguments_[index + 1];
      index += 1;
    } else {
      throw new Error('Usage: node scripts/release-secret-scan.mjs [--ref <git-ref>]');
    }
  }
  return { ref };
};

export const main = async (arguments_ = process.argv.slice(2)) => {
  const { ref } = parseArguments(arguments_);
  const result = await scanRepository({ ref });
  if (result.findings.length > 0) {
    throw new Error(
      `Release secret scan found ${result.findings.length} credential-shaped value(s). Values are intentionally omitted.\n${formatFindings(result.findings)}`
    );
  }
  process.stdout.write(
    `Release secret scan passed (${result.workingTreeFiles} working-tree files; ${result.indexBlobs} index blobs; ${result.historicalBlobs} reachable historical blobs).\n`
  );
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Release secret scan failed.'}\n`);
    process.exitCode = 1;
  });
}
