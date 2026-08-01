import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const liveRoot = resolve(root, 'test', 'fixtures', 'live');

const patterns = [
  ['Salesforce access token or SID', /\b00D[A-Za-z0-9]{12,15}![A-Za-z0-9._-]{8,}\b/u],
  ['Salesforce org ID', /(?<![A-Za-z0-9])00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?(?![A-Za-z0-9])/u],
  ['Salesforce user ID', /(?<![A-Za-z0-9])005[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?(?![A-Za-z0-9])/u],
  ['Salesforce consumer key', /\b3MVG9[A-Za-z0-9._-]{20,}\b/u],
  ['Data 360 tenant ID', /\ba360\/(?:prod|test)\/[a-f0-9]{16,}\b/iu],
  ['sfdx auth URL', /\bforce:\/\/[^\s"']+/iu],
  ['frontdoor SID URL', /\/secur\/frontdoor\.jsp\?[^#\s"']*\bsid=/iu],
  [
    'Salesforce org hostname',
    /\b(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:cloudforce\.com|documentforce\.com|my\.salesforce\.com|my\.site\.com|salesforce-experience\.com|salesforce-hyperforce\.com|salesforce-sites\.com|salesforce-setup\.com|visualforce\.com)|(?:[a-z0-9-]+\.)+force\.com|[a-z]{2,5}\d{1,4}[a-z]?\.salesforce\.com)\b/iu,
  ],
  ['Data 360 tenant hostname', /\b(?:[a-z0-9-]+\.)+c360a\.salesforce\.com\b/iu],
  ['bearer credential', /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/u],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/u],
  [
    'support correlation ID',
    /\b(?:correlation|request|trace)(?:[-_ ]?id)?\s*[:=]\s*(?!\[REDACTED\])["\\]*[a-f0-9-]{8,}\b/iu,
  ],
];
const secretKeys =
  /^(?:access_?token|authorization|bearer|client_?secret|consumer_?key|core_?token|id_?token|jwt|password|api_?key|private_?key|refresh_?token|secret|subject_?token|token)$/iu;

const collect = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(path)));
    else if (entry.name.endsWith('.json')) files.push(path);
  }
  return files;
};

const failures = [];
for (const path of await collect(liveRoot)) {
  const contents = await readFile(path, 'utf8');
  for (const [label, pattern] of patterns) {
    if (pattern.test(contents)) failures.push(`${relative(root, path)}: ${label}`);
  }
  for (const match of contents.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/giu)) {
    if (match[1].toLowerCase() !== 'example.invalid') {
      failures.push(`${relative(root, path)}: email address`);
      break;
    }
  }
  const inspectSecretKeys = (value, location = '') => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => inspectSecretKeys(entry, `${location}[${index}]`));
      return;
    }
    if (typeof value === 'string') {
      try {
        const nested = JSON.parse(value);
        if (nested && typeof nested === 'object') inspectSecretKeys(nested, `${location}<json>`);
      } catch {}
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (secretKeys.test(key) && entry !== '[REDACTED]') {
        failures.push(`${relative(root, path)}: secret-valued key ${location}.${key}`);
      } else {
        inspectSecretKeys(entry, `${location}.${key}`);
      }
    }
  };
  inspectSecretKeys(JSON.parse(contents));
  const fixture = JSON.parse(contents);
  const command = fixture?.__fixture?.command;
  const successfulLive = fixture?.__fixture?.source === 'live-scrubbed' && fixture?.__fixture?.outcome !== 'error';
  if (
    successfulLive &&
    [
      'data360 query',
      'data360 query hybrid',
      'data360 query results',
      'data360 query resume',
      'data360 query vector',
    ].includes(command) &&
    Array.isArray(fixture?.result?.rows) &&
    fixture.result.rows.length > 0
  ) {
    failures.push(`${relative(root, path)}: live record rows`);
  }
  if (
    successfulLive &&
    [
      'data360 activation results',
      'data360 calculated-insight query',
      'data360 data-graph query',
      'data360 profile get',
      'data360 profile lookup',
    ].includes(command) &&
    fixture?.result?.item?.redacted !== true
  ) {
    failures.push(`${relative(root, path)}: live record item`);
  }
}

if (failures.length > 0) {
  throw new Error(`Live fixture safety scan failed:\n- ${failures.join('\n- ')}`);
}

process.stdout.write(`Live fixture safety scan passed (${(await collect(liveRoot)).length} files).\n`);
