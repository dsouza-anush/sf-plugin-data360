import { expect } from 'chai';

type RedactorModule = {
  findLeaks: (value: unknown) => string[];
  redactValue: (value: unknown) => unknown;
};

describe('Agent Testbed redactor', () => {
  it('fully redacts multiword assignments before the second-pass leak scan', async () => {
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { findLeaks, redactValue } = (await import('../testbed/lib/redactor.mjs')) as RedactorModule;
    const dirty = [
      'password="correct horse battery staple"', // secret-scan: synthetic-fixture
      'client_secret: top secret value', // secret-scan: synthetic-fixture
    ];

    expect(findLeaks(dirty)).to.include('secret-valued field');
    const redacted = redactValue(dirty);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.to.include('correct horse battery staple');
    expect(serialized).not.to.include('top secret value');
    expect(redacted).to.deep.equal(['password="<redacted:secret>"', 'client_secret: <redacted:secret>']);
    expect(findLeaks(redacted)).to.deep.equal([]);
  });

  it('does not flag a redacted assignment separated by escaped whitespace', async () => {
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { findLeaks } = (await import('../testbed/lib/redactor.mjs')) as RedactorModule;
    const serializedHelpEvent = JSON.stringify({ preview: 'Fetch a Direct API token:\n\n    <redacted:secret>\n' });

    expect(findLeaks(serializedHelpEvent)).to.deep.equal([]);
  });

  it('hashes Salesforce record IDs and UUIDs embedded in traced URLs', async () => {
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { findLeaks, redactValue } = (await import('../testbed/lib/redactor.mjs')) as RedactorModule;
    const salesforceId = '001000000000001AAA';
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const dirty = {
      url: `https://fixture.my.salesforce.com/services/data/v67.0/ssot/resources/${salesforceId}/${uuid}`, // secret-scan: synthetic-fixture
    };

    expect(findLeaks(dirty)).to.include.members(['Salesforce record ID', 'UUID']);
    const redacted = redactValue(dirty) as { url: string };
    expect(redacted.url).to.match(
      /^https:\/\/<tenant>\/services\/data\/v67\.0\/ssot\/resources\/<record:[0-9a-f]{12}>\/<uuid:[0-9a-f]{12}>$/u
    );
    expect(findLeaks(redacted)).to.deep.equal([]);
  });

  it('fingerprints support trace IDs while preserving correlation inside private evidence', async () => {
    // @ts-expect-error -- The source-only testbed is intentionally plain ESM JavaScript.
    const { findLeaks, redactValue } = (await import('../testbed/lib/redactor.mjs')) as RedactorModule;
    const traceId = 'ce5d76023c4c80ba8200d776850300d9';
    const dirty = {
      headers: { 'request-id': traceId, 'x-request-id': traceId },
      message: `NOT_FOUND [TraceId:${traceId}]`,
    };

    expect(findLeaks(dirty)).to.include('support correlation ID');
    const redacted = redactValue(dirty) as {
      headers: { 'request-id': string; 'x-request-id': string };
      message: string;
    };
    expect(redacted.headers['request-id']).to.match(/^<support:[0-9a-f]{12}>$/u);
    expect(redacted.headers['x-request-id']).to.equal(redacted.headers['request-id']);
    expect(redacted.message).to.match(/TraceId:<support:[0-9a-f]{12}>/u);
    expect(JSON.stringify(redacted)).not.to.include(traceId);
    expect(findLeaks(redacted)).to.deep.equal([]);
  });
});
