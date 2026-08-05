import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from 'chai';

const root = resolve(import.meta.dirname, '..');
const trackedLiveDocs = [
  'LIVE_TESTING.md',
  'TESTING.md',
  'docs/CLI_CONTRACT.md',
  'README.md',
  'SECURITY.md',
  '.env.live.example',
];

describe('live testing documentation', () => {
  it('documents the complete live access and verification workflow', async () => {
    const runbook = await readFile(resolve(root, 'LIVE_TESTING.md'), 'utf8');

    for (const heading of [
      'Required authorization',
      'Environment controls',
      'Read-only smoke',
      'Mutations and billable operations',
      'Evidence and cleanup',
      'CI setup',
      'Forbidden data',
    ]) {
      expect(runbook, heading).to.include(`## ${heading}`);
    }

    for (const value of [
      '<test-org>',
      'sf org display',
      'yarn test:nuts:live:readonly',
      'D360_LIVE_ORG',
      'TESTKIT_AUTH_URL',
      'D360_LIVE_MUTATIONS',
      'D360_LIVE_BILLABLE',
      'D360_LIVE_SHARED_DATA',
      'D360_INGEST_SOURCE',
      'D360_INGEST_OBJECT',
      'D360_STREAM_ID',
      'D360_DLO_NAME',
      'D360_STREAM_API_NAME',
    ]) {
      expect(runbook, value).to.include(value);
    }

    for (const phase of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
      expect(runbook, phase).to.match(new RegExp(`\\b${phase}\\b`, 'u'));
    }
  });

  it('links the authoritative runbook from related documentation', async () => {
    for (const path of ['README.md', 'TESTING.md', 'docs/CLI_CONTRACT.md', 'SECURITY.md']) {
      expect(await readFile(resolve(root, path), 'utf8'), path).to.include('LIVE_TESTING.md');
    }
  });

  it('contains placeholders only and rejects credential-shaped data', async () => {
    const files = await Promise.all(
      trackedLiveDocs.map(async (path) => ({ path, contents: await readFile(resolve(root, path), 'utf8') }))
    );
    const forbidden = [
      { label: 'Salesforce access token or SID', pattern: /\b00D[A-Za-z0-9]{12,15}![A-Za-z0-9._-]{8,}\b/u },
      { label: 'Salesforce consumer key', pattern: /\b3MVG9[A-Za-z0-9._-]{20,}\b/u },
      { label: 'Data 360 tenant ID', pattern: /\ba360\/(?:prod|test)\/[a-f0-9]{16,}\b/iu },
      { label: 'sfdx auth URL', pattern: /\bforce:\/\/[^<\s]+/iu },
      { label: 'frontdoor SID URL', pattern: /\/secur\/frontdoor\.jsp\?[^#\s]*\bsid=/iu },
      { label: 'refresh token value', pattern: /\brefresh[_ -]?token\s*[:=]\s*(?!<)[^\s#]+/iu },
      { label: 'password value', pattern: /\bpassword\s*[:=]\s*(?!<)[^\s#]+/iu },
      { label: 'consumer key assignment', pattern: /\b(?:client[_ -]?id|consumer[_ -]?key)\s*[:=]\s*(?!<)[^\s#]+/iu },
      { label: 'dedicated org alias', pattern: /\bd360-(?:live|test)\b/iu },
      { label: 'dedicated ECA API name', pattern: /\bD360CliVerify_\d+\b/u },
      { label: 'dedicated source name', pattern: /\bLive_Verify_Ingest_\d+\b/u },
      { label: 'Salesforce instance identifier', pattern: /\bUSA\d{2,}\b/u },
    ];

    for (const { path, contents } of files) {
      for (const { label, pattern } of forbidden) {
        expect(contents, `${path}: ${label}`).not.to.match(pattern);
      }
    }
  });
});
