import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import type { Connection } from '@salesforce/core';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import ApiRequest from '../src/commands/data360/api/request.js';
import MetadataList from '../src/commands/data360/metadata/list.js';
import Query from '../src/commands/data360/query.js';
import { appendTraceEvent, redactTraceString, redactTraceValue, tracePayload } from '../src/client/trace.js';
import { request, type Transport } from '../src/client/request.js';
import { exchangeConnection } from '../src/client/tokenExchange.js';
import { executeRawRequest } from '../src/api/rawRequest.js';
import { createCommandTestContext } from './helpers/command.js';

const readEvents = async (path: string): Promise<Array<Record<string, unknown>>> =>
  (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe('Agent Testbed trace hook', () => {
  const commandTest = createCommandTestContext();
  let previousTrace: string | undefined;
  let previousTraceId: string | undefined;
  let previousCommandSeq: string | undefined;

  beforeEach(() => {
    previousTrace = process.env.SF_DATA360_TRACE;
    previousTraceId = process.env.SF_DATA360_TRACE_ID;
    previousCommandSeq = process.env.SF_DATA360_TRACE_COMMAND_SEQ;
    delete process.env.SF_DATA360_TRACE_COMMAND_SEQ;
  });

  afterEach(() => {
    if (previousTrace === undefined) delete process.env.SF_DATA360_TRACE;
    else process.env.SF_DATA360_TRACE = previousTrace;
    if (previousTraceId === undefined) delete process.env.SF_DATA360_TRACE_ID;
    else process.env.SF_DATA360_TRACE_ID = previousTraceId;
    if (previousCommandSeq === undefined) delete process.env.SF_DATA360_TRACE_COMMAND_SEQ;
    else process.env.SF_DATA360_TRACE_COMMAND_SEQ = previousCommandSeq;
    process.exitCode = undefined;
  });

  it('redacts a known-dirty corpus before computing trace payloads', () => {
    const dirty = {
      access_token: 'secret-token-value', // secret-scan: synthetic-fixture
      authorization: 'Bearer secret-bearer-value', // secret-scan: synthetic-fixture
      nested: {
        user: 'agent@example.com',
        org: '00D000000000001AAA', // secret-scan: synthetic-fixture
        recordId: '001000000000001AAA', // secret-scan: synthetic-fixture
        uuid: '123e4567-e89b-12d3-a456-426614174000',
        host: 'fixture.my.salesforce.com', // secret-scan: synthetic-fixture
        jwt: 'eyJhbGciOiJIUzI1NiJ9.cGF5bG9hZA.c2lnbmF0dXJl', // secret-scan: synthetic-fixture
        cookie: 'sid=opaque-cookie-secret',
        'x-custom-token': 'opaque-custom-token',
      },
      argv: ['--header', 'Cookie: opaque-cli-cookie'],
      frontdoor: 'https://na123.salesforce.com/secur/frontdoor.jsp?sid=opaque-frontdoor-session', // secret-scan: synthetic-fixture
      privateKey: '-----BEGIN PRIVATE KEY-----\nopaque-key-material\n-----END PRIVATE KEY-----', // secret-scan: synthetic-fixture
    };
    const redacted = redactTraceValue(dirty);
    const serialized = JSON.stringify(redacted);
    for (const forbidden of [
      'secret-token-value',
      'secret-bearer-value',
      'agent@example.com',
      '00D000000000001AAA', // secret-scan: synthetic-fixture
      '001000000000001AAA', // secret-scan: synthetic-fixture
      '123e4567-e89b-12d3-a456-426614174000',
      'fixture.my.salesforce.com', // secret-scan: synthetic-fixture
      'eyJhbGciOiJIUzI1NiJ9', // secret-scan: synthetic-fixture
      'opaque-cookie-secret',
      'opaque-custom-token',
      'opaque-cli-cookie',
      'opaque-frontdoor-session',
      'opaque-key-material',
      'na123.salesforce.com', // secret-scan: synthetic-fixture
    ]) {
      expect(serialized).not.to.include(forbidden);
    }
    expect(redactTraceString('/Users/alice/project')).to.equal('/Users/<user>/project');
    expect(
      redactTraceString(
        'https://fixture.my.salesforce.com/services/data/v67.0/ssot/resources/001000000000001AAA/123e4567-e89b-12d3-a456-426614174000' // secret-scan: synthetic-fixture
      )
    ).to.match(
      /^https:\/\/<tenant>\/services\/data\/v67\.0\/ssot\/resources\/<record:[0-9a-f]{12}>\/<uuid:[0-9a-f]{12}>$/u
    );
    const sessionWithBase64Punctuation = `${'00D'}A1b2C3d4E5f6G7H!A+opaque/session=value`;
    expect(redactTraceString(sessionWithBase64Punctuation)).to.equal('<redacted:access-token>');
    expect(
      redactTraceValue(['data360', 'query', '--query', "SELECT * FROM Customer WHERE email = 'private'"])
    ).to.deep.equal(['data360', 'query', '--query', '<redacted:secret>']);
    expect(redactTraceValue(['data360', 'api', 'request', '/example', '-b', '{"customer":"private"}'])).to.deep.equal([
      'data360',
      'api',
      'request',
      '/example',
      '-b',
      '<redacted:secret>',
    ]);
    expect(
      redactTraceValue([
        'data360',
        'query',
        "--query=SELECT * FROM Customer WHERE email = 'private-long'",
        "-qSELECT * FROM Customer WHERE email = 'private-short'",
        '--body={"customer":"private-long-body"}',
        '-b{"customer":"private-short-body"}',
      ])
    ).to.deep.equal([
      'data360',
      'query',
      '--query=<redacted:secret>',
      '-q<redacted:secret>',
      '--body=<redacted:secret>',
      '-b<redacted:secret>',
    ]);
    expect(
      redactTraceValue([
        'data360',
        'query',
        'vector',
        '--text',
        'private search phrase',
        '-tprivate short phrase',
        '--text=private inline phrase',
      ])
    ).to.deep.equal([
      'data360',
      'query',
      'vector',
      '--text',
      '<redacted:secret>',
      '-t<redacted:secret>',
      '--text=<redacted:secret>',
    ]);
    expect(tracePayload(dirty).preview).to.equal(serialized);
    expect(tracePayload('subject_token=core-token-secret&grant_type=fixture').preview).not.to.include(
      'core-token-secret'
    );
    expect(tracePayload('{"access_token":"json-token-secret"}').preview).not.to.include('json-token-secret');
  });

  it('fully redacts quoted and unquoted multiword secret assignments', () => {
    const quoted = redactTraceString('password="correct horse battery staple"'); // secret-scan: synthetic-fixture
    const unquoted = redactTraceString('client_secret: top secret value'); // secret-scan: synthetic-fixture

    expect(quoted).to.equal('password="<redacted:secret>"');
    expect(unquoted).to.equal('client_secret: <redacted:secret>');
    expect(`${quoted}\n${unquoted}`).not.to.include('correct horse battery staple');
    expect(`${quoted}\n${unquoted}`).not.to.include('top secret value');
  });

  it('fingerprints support identifiers in trace fields and nested messages', () => {
    const traceId = 'ce5d76023c4c80ba8200d776850300d9';
    const redacted = redactTraceValue({
      traceId,
      headers: { 'x-request-id': traceId },
      message: `NOT_FOUND [TraceId:${traceId}]`,
    }) as { traceId: string; headers: { 'x-request-id': string }; message: string };

    expect(redacted.traceId).to.match(/^<support:[0-9a-f]{12}>$/u);
    expect(redacted.headers['x-request-id']).to.equal(redacted.traceId);
    expect(redacted.message).to.match(/TraceId:<support:[0-9a-f]{12}>/u);
    expect(JSON.stringify(redacted)).not.to.include(traceId);
  });

  it('records redacted request and actual response metadata without changing transport behavior', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'd360-trace-request-'));
    const path = join(directory, 'events.jsonl');
    process.env.SF_DATA360_TRACE = path;
    process.env.SF_DATA360_TRACE_ID = 'trace-request-0001';
    process.env.SF_DATA360_TRACE_COMMAND_SEQ = '0';
    let headers: Record<string, string> | undefined;

    const transport: Transport = async <T>(transportRequest: Parameters<Transport>[0]): Promise<T> => {
      headers = transportRequest.headers;
      transportRequest.onResponse?.(
        201,
        {
          'content-type': 'application/json',
          'request-id': 'request-1',
          'set-cookie': 'sid=opaque-response-cookie',
          location: 'https://na123.salesforce.com/secur/frontdoor.jsp?sid=opaque-location-session', // secret-scan: synthetic-fixture
        },
        { ok: true, access_token: 'response-secret' } // secret-scan: synthetic-fixture
      );
      return { ok: true } as T;
    };
    const result = await request<{ ok: boolean }>(transport, {
      method: 'POST',
      url: '/services/data/v67.0/ssot/query-sql',
      body: { sql: 'SELECT 1', access_token: 'request-secret' }, // secret-scan: synthetic-fixture
      headers: { authorization: 'Bearer transport-secret' }, // secret-scan: synthetic-fixture
      parseMs: 1,
      connectionMs: 2,
      traceRoot: 'ssot',
    });

    expect(result).to.deep.equal({ ok: true });
    expect(headers?.['x-client-trace-id']).to.equal('trace-request-0001');
    const serialized = await readFile(path, 'utf8');
    expect(serialized).not.to.include('request-secret').and.not.to.include('response-secret');
    expect(serialized).not.to.include('transport-secret');
    expect(serialized).not.to.include('opaque-response-cookie').and.not.to.include('opaque-location-session');
    const events = await readEvents(path);
    expect(events.map(({ type }) => type)).to.deep.equal(['http.request', 'http.response']);
    expect(events.map(({ sid }) => sid)).to.deep.equal(['trace-request-0001', 'trace-request-0001']);
    expect(events[0]).to.deep.include({ method: 'POST', root: 'ssot', retryAttempt: 0, seqRef: 0 });
    expect(events[1]).to.deep.include({ status: 201, retryAttempt: 0, seqRef: 0 });
    expect(events[1].headers).to.deep.equal({
      'content-type': 'application/json',
      'request-id': '<support:19f1064b619d>',
    });
    expect(events[1].requestRef).to.equal(events[0].seq);
  });

  it('emits command, HTTP, and result events around a real parsed command', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'd360-trace-command-'));
    const path = join(directory, 'events.jsonl');
    process.env.SF_DATA360_TRACE = path;
    process.env.SF_DATA360_TRACE_ID = 'trace-command-0001';
    const org = new MockTestOrgData('trace-command');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (): Promise<never> => ({ metadata: [] }) as never;

    const result = await MetadataList.run(['--target-org', org.username, '--limit', '1', '--json']);

    expect(result.entities).to.deep.equal([]);
    const events = await readEvents(path);
    expect(events.map(({ type }) => type)).to.deep.equal([
      'command.exec',
      'http.request',
      'http.response',
      'command.result',
    ]);
    expect(events.every(({ sid }) => sid === 'trace-command-0001')).to.equal(true);
    expect(String(events[0].command)).to.include('metadata');
    expect(events[3]).to.deep.include({ exitCode: 0, seqRef: events[0].seq });
    expect(events[3].timing).to.be.an('object');
    expect(process.env.SF_DATA360_TRACE_COMMAND_SEQ).to.equal(undefined);
  });

  it('redacts split and attached query/body values through real oclif parsing and command tracing', async function () {
    this.timeout(process.platform === 'win32' ? 60_000 : 10_000);
    const directory = await mkdtemp(join(tmpdir(), 'd360-trace-argv-'));
    const path = join(directory, 'events.jsonl');
    process.env.SF_DATA360_TRACE = path;
    process.env.SF_DATA360_TRACE_ID = 'trace-argv-0001';
    const org = new MockTestOrgData('trace-argv');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (): Promise<never> =>
      ({
        status: { queryId: 'trace-query', completionStatus: 'ResultsProduced', rowCount: 1 },
        data: [['ok']],
        metadata: [{ name: 'marker', type: 'TEXT' }],
        returnedRows: 1,
      }) as never;
    commandTest.context.SANDBOX.stub(globalThis, 'fetch').callsFake(
      async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    commandTest.context.SANDBOX.stub(process.stdout, 'write').returns(true);

    const cases: Array<{ marker: string; run: () => Promise<unknown> }> = [
      {
        marker: 'TRACE_QUERY_SPLIT_LONG',
        run: () =>
          Query.run([
            '--target-org',
            org.username,
            '--query',
            "SELECT 'TRACE_QUERY_SPLIT_LONG'",
            '--no-prompt',
            '--json',
          ]),
      },
      {
        marker: 'TRACE_QUERY_SPLIT_SHORT',
        run: () =>
          Query.run(['--target-org', org.username, '-q', "SELECT 'TRACE_QUERY_SPLIT_SHORT'", '--no-prompt', '--json']),
      },
      {
        marker: 'TRACE_QUERY_INLINE_LONG',
        run: () =>
          Query.run([
            '--target-org',
            org.username,
            "--query=SELECT 'TRACE_QUERY_INLINE_LONG'",
            '--no-prompt',
            '--json',
          ]),
      },
      {
        marker: 'TRACE_QUERY_ATTACHED_SHORT',
        run: () =>
          Query.run(['--target-org', org.username, "-qSELECT 'TRACE_QUERY_ATTACHED_SHORT'", '--no-prompt', '--json']),
      },
      {
        marker: 'TRACE_BODY_SPLIT_LONG',
        run: () =>
          ApiRequest.run([
            '--target-org',
            org.username,
            'segments',
            '--method',
            'POST',
            '--body',
            '{"marker":"TRACE_BODY_SPLIT_LONG"}',
            '--no-prompt',
          ]),
      },
      {
        marker: 'TRACE_BODY_SPLIT_SHORT',
        run: () =>
          ApiRequest.run([
            '--target-org',
            org.username,
            'segments',
            '--method',
            'POST',
            '-b',
            '{"marker":"TRACE_BODY_SPLIT_SHORT"}',
            '--no-prompt',
          ]),
      },
      {
        marker: 'TRACE_BODY_INLINE_LONG',
        run: () =>
          ApiRequest.run([
            '--target-org',
            org.username,
            'segments',
            '--method',
            'POST',
            '--body={"marker":"TRACE_BODY_INLINE_LONG"}',
            '--no-prompt',
          ]),
      },
      {
        marker: 'TRACE_BODY_ATTACHED_SHORT',
        run: () =>
          ApiRequest.run([
            '--target-org',
            org.username,
            'segments',
            '--method',
            'POST',
            '-b{"marker":"TRACE_BODY_ATTACHED_SHORT"}',
            '--no-prompt',
          ]),
      },
    ];

    for (const testCase of cases) await testCase.run();

    const commandEvents = (await readEvents(path)).filter(({ type }) => type === 'command.exec');
    expect(commandEvents).to.have.length(cases.length);
    const serialized = JSON.stringify(commandEvents);
    for (const { marker } of cases) expect(serialized).not.to.include(marker);
    expect(serialized.match(/<redacted:secret>/gu)).to.have.length(cases.length);
  });

  it('traces token exchange and bounded raw response bodies only when enabled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'd360-trace-transports-'));
    const path = join(directory, 'events.jsonl');
    const env = {
      SF_DATA360_TRACE: path,
      SF_DATA360_TRACE_ID: 'trace-transports-0001',
    };
    const connection = {
      instanceUrl: 'https://org.example',
      accessToken: 'synthetic-core-token',
      refreshAuth: async (): Promise<void> => undefined,
    } as unknown as Connection;

    const token = await exchangeConnection(connection, {
      env,
      fetch: async () =>
        new Response(
          JSON.stringify({
            access_token: 'tenant-jwt-secret',
            instance_url: 'https://tenant.c360a.salesforce.com',
            expires_in: 300,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        ),
    });
    expect(token.jwt).to.equal('tenant-jwt-secret');

    const raw = await executeRawRequest(
      connection,
      { apiVersion: '67.0', endpoint: 'limits', method: 'POST', headers: [], body: '{"probe":true}', env },
      async () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-length': '11', 'content-type': 'application/json' },
        })
    );
    expect(await raw.json()).to.deep.equal({ ok: true });

    const events = await readEvents(path);
    expect(events.map(({ type }) => type)).to.deep.equal([
      'http.request',
      'http.response',
      'http.request',
      'http.response',
    ]);
    expect(events.filter(({ type }) => type === 'http.response').map(({ status }) => status)).to.deep.equal([200, 200]);
    expect(
      events.filter(({ type }) => type === 'http.response').every((event) => !('bodyPreview1k' in event))
    ).to.equal(true);
  });

  it('drops trace filesystem failures instead of changing command behavior', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'd360-trace-failure-'));
    const blocker = join(directory, 'not-a-directory');
    await writeFile(blocker, 'block child creation');
    process.env.SF_DATA360_TRACE = join(blocker, 'events.jsonl');
    process.env.SF_DATA360_TRACE_ID = 'trace-failure-0001';
    expect(await appendTraceEvent({ type: 'note', text: 'ignored' })).to.equal(undefined);
  });
});
