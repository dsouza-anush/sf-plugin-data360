import { readFile } from 'node:fs/promises';
import { redactString, redactValue } from '../testbed/lib/redactor.mjs';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/scrub-fixture.mjs <raw.json>');
const provenanceIndex = process.argv.indexOf('--source');
const provenance = provenanceIndex >= 0 ? process.argv[provenanceIndex + 1] : undefined;
if (provenance && !['live-scrubbed', 'synthetic'].includes(provenance)) {
  throw new Error('Fixture source must be live-scrubbed or synthetic.');
}

const replacements = [
  [
    /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/gu,
    'REDACTED_PRIVATE_KEY',
  ],
  [
    /(?<![A-Za-z0-9])00D[A-Za-z0-9]{12,15}(?:!|%21)[A-Za-z0-9._~+%/=-]{8,}(?![A-Za-z0-9._~+%/=-])/gu,
    'REDACTED_ACCESS_TOKEN',
  ],
  [/(?<![A-Za-z0-9])00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?(?![A-Za-z0-9])/gu, 'LIVE_ID_ORG'],
  [/\b005[A-Za-z0-9]{12,15}\b/gu, '005000000000001'],
  [/\ba360\/(?:prod|test)\/[a-f0-9]{16,}\b/giu, 'a360/[REDACTED_TENANT]'],
  [/\b((?:correlation|request|trace)(?:[-_ ]?id)?\s*[:=]\s*)[a-f0-9-]{8,}\b/giu, '$1[REDACTED]'],
  [/\b(?:[a-z0-9-]+\.)*c360a\.salesforce\.com\b/giu, 'mock.c360a.example'],
  [
    /\b(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:cloudforce\.com|documentforce\.com|my\.salesforce\.com|my\.site\.com|salesforce-experience\.com|salesforce-hyperforce\.com|salesforce-sites\.com|salesforce-setup\.com|visualforce\.com)|(?:[a-z0-9-]+\.)+force\.com|[a-z]{2,5}\d{1,4}[a-z]?\.salesforce\.com)\b/giu,
    'mock.salesforce.example',
  ],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, 'user@example.invalid'],
];

let text = await readFile(source, 'utf8');
for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
text = redactString(text);

const secretKeys =
  /^(?:access_?token|authorization|bearer|client_?secret|consumer_?key|core_?token|id_?token|jwt|password|api_?key|private_?key|refresh_?token|secret|subject_?token|token)$/iu;
const supportIdentifierKeys = /^(?:correlation|request|trace)(?:_|-)?id$|^x-client-trace-id$/iu;
const redactSecrets = (value) => {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === 'string') {
    try {
      const nested = JSON.parse(value);
      if (nested && typeof nested === 'object') return JSON.stringify(redactSecrets(nested));
    } catch {}
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !secretKeys.test(key) && !supportIdentifierKeys.test(key))
      .map(([key, entry]) => [key, redactSecrets(entry)])
  );
};

const parsed = redactValue(redactSecrets(JSON.parse(text)));
if (provenance) {
  parsed.__fixture = { source: provenance };
  if (provenance === 'synthetic') parsed.synthetic = true;
  else delete parsed.synthetic;
}
process.stdout.write(`${JSON.stringify(parsed, undefined, 2)}\n`);
