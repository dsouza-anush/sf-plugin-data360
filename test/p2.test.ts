import { expect } from 'chai';
import type { Connection } from '@salesforce/core';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import {
  A360_GRANT_TYPE,
  SUBJECT_TOKEN_TYPE,
  exchangeConnection,
  validateTenantUrl,
} from '../src/client/tokenExchange.js';
import { TokenCache } from '../src/client/tokenCache.js';
import { DirectClient, resolveDirectPath } from '../src/client/directClient.js';
import TokenDisplay from '../src/commands/data360/token/display.js';
import ApiRequest from '../src/commands/data360/api/request.js';
import { assertRejects } from './helpers/async.js';
import { loadFixture } from './helpers/fixtures.js';
import { createCommandTestContext } from './helpers/command.js';
import { runDoctorChecks } from '../src/doctor/checks.js';
import { ReplParser } from '../src/repl/session.js';
import { runRepl } from '../src/repl/run.js';
import { replHistoryPath } from '../src/repl/history.js';
import { PassThrough, Readable } from 'node:stream';
import { chmod, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { replExecutionOptions, shouldEnterRepl } from '../src/commands/data360/query.js';

const success = loadFixture<{
  access_token: string;
  instance_url: string;
  expires_in: number;
  scope: string;
}>('token/exchange-success.json');
const successWithoutScopes = loadFixture<{
  access_token: string;
  instance_url: string;
  expires_in: number;
  issued_token_type: string;
  token_type: string;
}>('token/exchange-success-no-scopes.json');
const invalidGrant = loadFixture<{ error: string; error_description: string }>('token/exchange-invalid-grant.json');
const appMissing = loadFixture<{ error: string; error_description: string }>('token/exchange-app-missing.json');

describe('P2 direct authentication', () => {
  const commandTest = createCommandTestContext();
  it('exchanges the core token with the exact documented grant and normalizes the response', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const connection = {
      instanceUrl: 'https://core.example',
      accessToken: 'core-token-secret',
      refreshAuth: async (): Promise<void> => undefined,
    } as unknown as Connection;
    const token = await exchangeConnection(connection, {
      now: () => Date.parse('2026-07-10T00:00:00.000Z'),
      fetch: async (input, init): Promise<Response> => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify(success), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    expect(requests).to.have.length(1);
    expect(requests[0].url).to.equal('https://core.example/services/a360/token');
    expect(requests[0].init?.method).to.equal('POST');
    expect(new Headers(requests[0].init?.headers).get('content-type')).to.equal('application/x-www-form-urlencoded');
    const body = new URLSearchParams(String(requests[0].init?.body));
    expect(body.get('grant_type')).to.equal(A360_GRANT_TYPE);
    expect(body.get('subject_token')).to.equal('core-token-secret');
    expect(body.get('subject_token_type')).to.equal(SUBJECT_TOKEN_TYPE);
    expect(token).to.deep.equal({
      jwt: 'tenant-jwt-secret',
      instanceUrl: 'https://mock.c360a.salesforce.com',
      expiresAt: '2026-07-10T01:00:00.000Z',
      scopes: ['cdp_api', 'cdp_query_api', 'cdp_profile_api', 'cdp_ingest_api'],
    });
    expect(JSON.stringify(requests)).to.not.include('tenant-jwt-secret');
  });

  it('does not report required scopes missing when a successful exchange omits scope inventory', async () => {
    const token = await exchangeConnection(
      {
        instanceUrl: 'https://core.example',
        accessToken: 'core-token-secret',
        refreshAuth: async (): Promise<void> => undefined,
      } as unknown as Connection,
      {
        now: () => Date.parse('2026-07-10T00:00:00.000Z'),
        fetch: async () =>
          new Response(JSON.stringify(successWithoutScopes), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      }
    );
    const checks = await runDoctorChecks({
      identity: async () => ({ username: 'user@example.com' }),
      maxApiVersion: async () => '67.0',
      request: async <T>(endpoint: string) =>
        (endpoint === '/data-spaces' ? { dataSpaces: [{ name: 'default' }] } : { metadata: [] }) as T,
      exchange: async () => token,
      directRequest: async () => ({ metadata: [] }),
      apiVersion: '67.0',
      dataSpace: 'default',
    });

    expect(token.scopes).to.equal(undefined);
    expect(checks.find(({ name }) => name === 'Direct API scopes')).to.deep.equal({
      name: 'Direct API scopes',
      status: 'warn',
      detail:
        'Token exchange did not report a scope inventory; the successful Direct metadata ping verifies cdp_api only.',
      action: 'Verify cdp_query_api, cdp_profile_api, and cdp_ingest_api before using those Direct APIs.',
    });
    expect(checks.some(({ status }) => status === 'fail')).to.equal(false);
    expect(JSON.stringify(checks)).to.not.include('tenant-jwt-secret').and.not.include('core-token-secret');
  });

  it('normalizes only bare Salesforce tenant hostnames and preserves absolute HTTPS and test loopback URLs', () => {
    expect(validateTenantUrl('mock.c360a.salesforce.com')).to.equal('https://mock.c360a.salesforce.com');
    expect(validateTenantUrl('https://mock.c360a.salesforce.com')).to.equal('https://mock.c360a.salesforce.com');
    expect(
      validateTenantUrl('http://127.0.0.1:4321', {
        NODE_ENV: 'test',
        SF_DATA360_TENANT_URL: 'http://127.0.0.1:4321',
      })
    ).to.equal('http://127.0.0.1:4321');

    for (const value of [
      'user:pass@mock.c360a.salesforce.com',
      'mock.c360a.salesforce.com/api/v1',
      'http://mock.c360a.salesforce.com',
      '127.0.0.1',
      'localhost',
      'mock.c360a.salesforce.com.evil.example',
      'evil.example',
      'not a hostname',
    ]) {
      expect(() => validateTenantUrl(value), value).to.throw();
    }
  });

  for (const [name, fixture] of [
    ['invalid grant', invalidGrant],
    ['missing External Client App', appMissing],
  ] as const) {
    it(`normalizes ${name} without exposing either token`, async () => {
      const error = await assertRejects(
        exchangeConnection(
          {
            instanceUrl: 'https://core.example',
            accessToken: 'core-token-secret',
            refreshAuth: async (): Promise<void> => undefined,
          } as unknown as Connection,
          {
            fetch: async () =>
              new Response(JSON.stringify(fixture), {
                status: 400,
                headers: { 'content-type': 'application/json' },
              }),
          }
        )
      );
      expect(error.name).to.equal('D360_TOKEN_EXCHANGE_FAILED');
      expect(error.message).to.include(fixture.error_description);
      expect((error as { exitCode?: number }).exitCode).to.equal(1);
      expect((error as { data?: unknown }).data).to.deep.equal({ httpStatus: 400 });
      expect(JSON.stringify(error)).to.not.include('core-token-secret').and.not.include('tenant-jwt-secret');
    });
  }

  it('gives actionable guidance when a successful exchange omits the access token', async () => {
    const payload = {
      instance_url: 'https://mock.c360a.salesforce.com',
      expires_in: 3600,
    };
    const error = await assertRejects(
      exchangeConnection(
        {
          instanceUrl: 'https://core.example',
          accessToken: 'core-token-secret',
          refreshAuth: async (): Promise<void> => undefined,
        } as unknown as Connection,
        {
          fetch: async () =>
            new Response(JSON.stringify(payload), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
        }
      )
    );

    expect(error.name).to.equal('D360_TOKEN_EXCHANGE_FAILED');
    expect(error.message).to.include('HTTP 200').and.include('did not return an access token');
    expect((error as { actions?: string[] }).actions).to.deep.equal([
      'Verify that the External Client App includes the required cdp_* scopes and is authorized for this user.',
      'Authenticate the org with the approved OAuth flow, then run sf data360 doctor and retry.',
    ]);
    expect((error as { data?: unknown }).data).to.deep.equal({ httpStatus: 200 });
    expect(JSON.stringify(error)).to.not.include('core-token-secret');
  });

  it('encrypts cached JWTs, applies the five-minute skew, and supports cache bypass', async () => {
    let stored: string | undefined;
    let exchanges = 0;
    let now = Date.parse('2026-07-10T00:00:00.000Z');
    const token = {
      jwt: 'tenant-jwt-secret',
      instanceUrl: 'https://tenant.c360a.salesforce.com',
      expiresAt: '2026-07-10T01:00:00.000Z',
      scopes: ['cdp_api'],
    };
    const cache = await TokenCache.create({
      now: () => now,
      storage: {
        read: async () => stored,
        write: async (contents) => {
          stored = contents;
        },
      },
      cipher: {
        encrypt: (value) => Buffer.from(value).toString('base64'),
        decrypt: (value) => Buffer.from(value, 'base64').toString(),
      },
      exchange: async () => {
        exchanges += 1;
        return token;
      },
    });
    const connection = {} as Connection;
    expect(await cache.get('user@example.com', connection)).to.deep.equal(token);
    expect(await cache.get('user@example.com', connection)).to.deep.equal(token);
    expect(exchanges).to.equal(1);
    expect(stored).to.not.include('tenant-jwt-secret');

    now = Date.parse('2026-07-10T00:55:00.000Z');
    await cache.get('user@example.com', connection);
    expect(exchanges).to.equal(2);
    await cache.get('user@example.com', connection, { useCache: false });
    expect(exchanges).to.equal(3);
  });

  it('rejects malicious exchange and cached tenant URLs before bearer use', async () => {
    for (const instanceUrl of [
      'http://tenant.c360a.salesforce.com',
      'https://user:pass@tenant.c360a.salesforce.com',
      'https://127.0.0.1',
      'https://169.254.169.254',
      'https://tenant.c360a.salesforce.com.evil.example',
      'https://evil.example',
    ]) {
      const error = await assertRejects(
        exchangeConnection(
          {
            instanceUrl: 'https://core.example',
            accessToken: 'core-token-secret',
            refreshAuth: async (): Promise<void> => undefined,
          } as unknown as Connection,
          {
            fetch: async () =>
              new Response(JSON.stringify({ ...success, instance_url: instanceUrl }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
          }
        )
      );
      expect(error.name, instanceUrl).to.equal('D360_TOKEN_EXCHANGE_FAILED');
    }

    let fetched = false;
    const maliciousCache = {
      get: async () => ({
        jwt: 'tenant-jwt-secret',
        instanceUrl: 'https://127.0.0.1',
        expiresAt: '2026-07-10T01:00:00.000Z',
        scopes: [],
      }),
      invalidate: async () => undefined,
    } as unknown as TokenCache;
    const client = new DirectClient({
      username: 'user@example.com',
      connection: {} as Connection,
      cache: maliciousCache,
      fetch: async (): Promise<Response> => {
        fetched = true;
        return new Response('{}');
      },
    });
    await assertRejects(client.get('metadata'), 'tenant');
    expect(fetched).to.equal(false);
  });

  it('bypasses all persistent cache operations and survives corrupt storage', async () => {
    const calls: string[] = [];
    const cache = await (TokenCache.create as unknown as (options: Record<string, unknown>) => Promise<TokenCache>)({
      bypass: true,
      storage: {
        read: async () => {
          calls.push('read');
          return 'corrupt';
        },
        write: async () => {
          calls.push('write');
        },
      },
      cipher: {
        encrypt: (value: string) => value,
        decrypt: (value: string) => {
          calls.push('decrypt');
          return value;
        },
      },
      exchange: async () => ({
        jwt: 'fresh-jwt',
        instanceUrl: 'https://tenant.c360a.salesforce.com',
        expiresAt: '2026-07-10T01:00:00.000Z',
        scopes: [],
      }),
    });
    expect((await cache.get('user@example.com', {} as Connection)).jwt).to.equal('fresh-jwt');
    await cache.invalidate('user@example.com');
    expect(calls).to.deep.equal([]);
  });

  it('invalidates one username without exposing another cached token', async () => {
    let stored: string | undefined;
    let exchanges = 0;
    const cache = await TokenCache.create({
      now: () => Date.parse('2026-07-10T00:00:00.000Z'),
      storage: {
        read: async () => stored,
        write: async (contents) => {
          stored = contents;
        },
      },
      cipher: {
        encrypt: (value) => `encrypted:${Buffer.from(value).toString('base64')}`,
        decrypt: (value) => Buffer.from(value.slice('encrypted:'.length), 'base64').toString(),
      },
      exchange: async () => {
        exchanges += 1;
        return {
          jwt: `jwt-${exchanges}`,
          instanceUrl: 'https://tenant.c360a.salesforce.com',
          expiresAt: '2026-07-10T01:00:00.000Z',
          scopes: [],
        };
      },
    });
    const connection = {} as Connection;
    await cache.get('one@example.com', connection);
    await cache.get('two@example.com', connection);
    await cache.invalidate('one@example.com');
    expect((await cache.get('two@example.com', connection)).jwt).to.equal('jwt-2');
    expect((await cache.get('one@example.com', connection)).jwt).to.equal('jwt-3');
  });

  it('roots Direct paths, honors only the loopback test override, and sends the tenant JWT', async () => {
    expect(resolveDirectPath('metadata')).to.equal('/api/v1/metadata');
    expect(resolveDirectPath('/api/v2/query')).to.equal('/api/v2/query');
    expect(resolveDirectPath('/api/v3/query')).to.equal('/api/v3/query');
    expect(() => resolveDirectPath('../private')).to.throw('traversal');
    expect(() => resolveDirectPath('metadata%zz')).to.throw('Invalid URL encoding');
    let deeplyEncodedTraversal = '../private';
    for (let index = 0; index < 4; index += 1) deeplyEncodedTraversal = encodeURIComponent(deeplyEncodedTraversal);
    expect(() => resolveDirectPath(deeplyEncodedTraversal)).to.throw('traversal');
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const cache = {
      get: async () => ({
        jwt: 'tenant-jwt-secret',
        instanceUrl: 'https://returned.c360a.salesforce.com',
        expiresAt: '2026-07-10T01:00:00.000Z',
        scopes: [],
      }),
      invalidate: async () => undefined,
    } as unknown as TokenCache;
    const client = new DirectClient({
      username: 'user@example.com',
      connection: {} as Connection,
      cache,
      env: { NODE_ENV: 'test', SF_DATA360_TENANT_URL: 'http://127.0.0.1:4321' },
      fetch: async (input, init): Promise<Response> => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get('authorization'),
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    expect(await client.get('/api/v1/metadata')).to.deep.equal({ ok: true });
    expect(requests).to.deep.equal([
      { url: 'http://127.0.0.1:4321/api/v1/metadata', authorization: 'Bearer tenant-jwt-secret' },
    ]);
  });

  it('invalidates and re-exchanges exactly once after a Direct 401', async () => {
    let tokenNumber = 0;
    let invalidations = 0;
    let requests = 0;
    const cache = {
      get: async () => {
        tokenNumber += 1;
        return {
          jwt: `tenant-jwt-${tokenNumber}`,
          instanceUrl: 'https://tenant.c360a.salesforce.com',
          expiresAt: '2026-07-10T01:00:00.000Z',
          scopes: [],
        };
      },
      invalidate: async () => {
        invalidations += 1;
      },
    } as unknown as TokenCache;
    const client = new DirectClient({
      username: 'user@example.com',
      connection: {} as Connection,
      cache,
      env: {},
      fetch: async (): Promise<Response> => {
        requests += 1;
        return requests === 1
          ? new Response(JSON.stringify({ message: 'expired' }), { status: 401 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    expect(await client.get('metadata')).to.deep.equal({ ok: true });
    expect({ requests, invalidations, tokenNumber }).to.deep.equal({ requests: 2, invalidations: 1, tokenNumber: 2 });

    requests = 0;
    const failing = new DirectClient({
      username: 'user@example.com',
      connection: {} as Connection,
      cache,
      env: {},
      fetch: async (): Promise<Response> => {
        requests += 1;
        return new Response(JSON.stringify({ message: 'expired' }), { status: 401 });
      },
    });
    const error = await assertRejects(failing.get('metadata'));
    expect(error.name).to.equal('D360_AUTH_EXPIRED');
    expect(requests).to.equal(2);
  });

  it('maps Direct 403 errors to the relevant missing scope and protects bearer headers', async () => {
    const cache = {
      get: async () => ({
        jwt: 'tenant-jwt-secret',
        instanceUrl: 'https://tenant.c360a.salesforce.com',
        expiresAt: '2026-07-10T01:00:00.000Z',
        scopes: [],
      }),
      invalidate: async () => undefined,
    } as unknown as TokenCache;
    for (const [endpoint, scope] of [
      ['/api/v1/metadata', 'cdp_api'],
      ['/api/v2/query', 'cdp_query_api'],
      ['/api/v3/query?transferMode=ADAPTIVE', 'cdp_query_api'],
      ['/api/v3/query/query-id/chunks/0', 'cdp_query_api'],
      ['/api/v1/profile/Individual', 'cdp_profile_api'],
      ['/api/v1/ingest/jobs', 'cdp_ingest_api'],
    ]) {
      const client = new DirectClient({
        username: 'user@example.com',
        connection: {} as Connection,
        cache,
        fetch: async (): Promise<Response> => new Response(JSON.stringify({ message: 'forbidden' }), { status: 403 }),
      });
      const error = await assertRejects(client.get(endpoint));
      expect(error.name, endpoint).to.equal('D360_SCOPE_MISSING');
      expect((error as Error & { actions?: string[] }).actions?.join(' '), endpoint).to.include(scope);
      expect(error.name, endpoint).to.not.equal('D360_NOT_PROVISIONED');
    }

    for (const header of ['authorization', 'Authorization', 'HOST', 'Content-Length']) {
      const client = new DirectClient({
        username: 'user@example.com',
        connection: {} as Connection,
        cache,
        fetch: async (): Promise<Response> => new Response('{}'),
      });
      await assertRejects(
        client.request({ method: 'GET', endpoint: 'metadata', headers: { [header]: 'attacker' } }),
        'cannot be overridden'
      );
    }
  });

  it('uses logSensitive in human mode and returns the documented JSON token fields', async () => {
    const org = new MockTestOrgData('token-display');
    await commandTest.context.stubAuths(org);
    const token = {
      jwt: 'tenant-jwt-secret',
      instanceUrl: 'https://tenant.c360a.salesforce.com',
      expiresAt: '2026-07-10T01:00:00.000Z',
      scopes: ['cdp_api', 'cdp_query_api'],
    };
    const createCache = commandTest.context.SANDBOX.stub(TokenCache, 'create').resolves({
      get: commandTest.context.SANDBOX.stub().resolves(token),
      close: commandTest.context.SANDBOX.stub(),
    } as unknown as TokenCache);

    const result = await TokenDisplay.run(['--target-org', org.username, '--json']);
    expect(result).to.deep.equal({
      accessToken: 'tenant-jwt-secret',
      instanceUrl: 'https://tenant.c360a.salesforce.com',
      expiresAt: '2026-07-10T01:00:00.000Z',
      scopes: ['cdp_api', 'cdp_query_api'],
    });
    expect(commandTest.ux.logSensitive.called).to.equal(false);

    await TokenDisplay.run(['--target-org', org.username]);
    expect(commandTest.ux.logSensitive.calledWithExactly('tenant-jwt-secret')).to.equal(true);
    expect(commandTest.ux.logToStderr.getCalls().some(({ args }) => /secret/iu.test(String(args[0])))).to.equal(true);
    await TokenDisplay.run(['--target-org', org.username, '--no-token-cache', '--json']);
    expect(createCache.calledWithMatch({ bypass: true })).to.equal(true);
  });

  it('runs api request --direct with raw byte and protected-header parity', async () => {
    const org = new MockTestOrgData('direct-api-request');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(TokenCache, 'create').resolves({
      get: commandTest.context.SANDBOX.stub().resolves({
        jwt: 'tenant-jwt-secret',
        instanceUrl: 'https://tenant.c360a.salesforce.com',
        expiresAt: '2026-07-10T01:00:00.000Z',
        scopes: [],
      }),
      invalidate: commandTest.context.SANDBOX.stub().resolves(),
      close: commandTest.context.SANDBOX.stub(),
    } as unknown as TokenCache);
    const fetchStub = commandTest.context.SANDBOX.stub(globalThis, 'fetch').resolves(
      new Response(new Uint8Array([0, 255, 10]), { status: 206, headers: { 'x-direct': 'yes' } })
    );
    const stdout = commandTest.context.SANDBOX.stub(process.stdout, 'write').returns(true);

    await ApiRequest.run([
      '--target-org',
      org.username,
      'metadata',
      '--direct',
      '--include',
      '--header',
      'x-test: value',
    ]);
    expect(String(fetchStub.firstCall.args[0])).to.equal('https://tenant.c360a.salesforce.com/api/v1/metadata');
    const headers = new Headers(fetchStub.firstCall.args[1]?.headers);
    expect(headers.get('authorization')).to.equal('Bearer tenant-jwt-secret');
    expect(headers.get('x-test')).to.equal('value');
    expect(stdout.firstCall.args[0]).to.equal('HTTP 206\nx-direct: yes\n\n');
    expect(Buffer.from(stdout.secondCall.args[0] as Uint8Array)).to.deep.equal(Buffer.from([0, 255, 10]));
  });

  it('fails doctor checks 5-7 without leaking tokens when Direct API is unusable', async () => {
    const token = {
      jwt: 'tenant-jwt-secret',
      instanceUrl: 'https://tenant.c360a.salesforce.com',
      expiresAt: '2026-07-10T01:00:00.000Z',
      scopes: ['cdp_api', 'cdp_query_api'],
    };
    const checks = await runDoctorChecks({
      identity: async () => ({ username: 'user@example.com' }),
      maxApiVersion: async () => '67.0',
      request: async <T>(endpoint: string) =>
        (endpoint === '/data-spaces' ? { dataSpaces: [{ name: 'default' }] } : { metadata: [] }) as T,
      exchange: async () => token,
      directRequest: async () => ({ metadata: [] }),
      apiVersion: '67.0',
      dataSpace: 'default',
    });
    expect(checks.find(({ name }) => name === 'Direct API token exchange')?.status).to.equal('pass');
    expect(checks.find(({ name }) => name === 'Direct API ping')?.status).to.equal('pass');
    const scopes = checks.find(({ name }) => name === 'Direct API scopes');
    expect(scopes?.status).to.equal('fail');
    expect(scopes?.detail).to.include('cdp_profile_api').and.include('cdp_ingest_api');
    expect(JSON.stringify(checks)).to.not.include('tenant-jwt-secret');

    const exchangeFailed = await runDoctorChecks({
      identity: async () => ({ username: 'user@example.com' }),
      maxApiVersion: async () => '67.0',
      request: async <T>(endpoint: string) =>
        (endpoint === '/data-spaces' ? { dataSpaces: [{ name: 'default' }] } : { metadata: [] }) as T,
      exchange: async () => {
        throw new Error('scope not allowed');
      },
      directRequest: async () => ({ metadata: [] }),
      apiVersion: '67.0',
      dataSpace: 'default',
    });
    expect(exchangeFailed.slice(4, 7).map(({ status }) => status)).to.deep.equal(['fail', 'fail', 'fail']);
  });

  it('parses REPL multiline SQL, P2 meta-commands, formats, and Ctrl-C behavior', () => {
    const parser = new ReplParser();
    expect(parser.handle('select id')).to.deep.equal({ type: 'continue' });
    expect(parser.handle('from Account;')).to.deep.equal({ type: 'query', sql: 'select id\nfrom Account' });
    expect(parser.handle('\\dt dmo')).to.deep.equal({ type: 'tables', entityType: 'dmo' });
    expect(parser.handle('\\d ssot__Account__dlm')).to.deep.equal({
      type: 'describe',
      entity: 'ssot__Account__dlm',
    });
    expect(parser.handle('\\f csv')).to.deep.equal({ type: 'format', format: 'csv' });
    expect(parser.handle('\\x')).to.deep.equal({ type: 'expanded' });
    expect(parser.handle('\\o rows.csv')).to.deep.equal({ type: 'output', file: 'rows.csv' });
    expect(parser.handle('\\dataspace analytics')).to.deep.equal({ type: 'dataSpace', name: 'analytics' });
    expect(parser.handle('\\timing')).to.deep.equal({ type: 'timing' });
    expect(parser.handle('\\i query.sql')).to.deep.equal({ type: 'include', file: 'query.sql' });
    expect(parser.handle('\\last')).to.deep.equal({ type: 'last' });
    expect(parser.handle('\\q')).to.deep.equal({ type: 'quit', exitCode: 0 });
    expect(parser.handle('select unfinished')).to.deep.equal({ type: 'continue' });
    expect(parser.interrupt()).to.deep.equal({ type: 'continue' });
    expect(parser.interrupt()).to.deep.equal({ type: 'continue' });
    expect(parser.interrupt()).to.deep.equal({ type: 'quit', exitCode: 130 });
  });

  it('requires stdin and stdout TTYs and seeds one-shot execution flags into REPL queries', () => {
    expect(shouldEnterRepl(true, true, false)).to.equal(true);
    expect(shouldEnterRepl(true, false, false)).to.equal(false);
    expect(shouldEnterRepl(false, true, false)).to.equal(false);
    expect(shouldEnterRepl(true, true, true)).to.equal(false);
    expect(replExecutionOptions({ async: true, resultFormat: 'csv', outputFile: 'rows.csv' })).to.deep.equal({
      async: true,
      format: 'csv',
      outputFile: 'rows.csv',
    });
  });

  it('runs an injected REPL session, persists XDG history, and exits without hanging', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-repl-'));
    const history = join(directory, 'history');
    const output = new PassThrough();
    let text = '';
    output.on('data', (chunk) => {
      text += String(chunk);
    });
    const calls: string[] = [];
    const exitCode = await runRepl({
      dataSpace: 'default',
      input: Readable.from(['select 1;\n', '\\f csv\n', '\\dt dmo\n', '\\d Account\n', '\\q\n']),
      output,
      historyPath: history,
      execute: async (sql, context) => {
        calls.push(`query:${context.format}:${sql}`);
        return 'query-id';
      },
      listTables: async (type) => {
        calls.push(`tables:${type}`);
      },
      describe: async (entity) => {
        calls.push(`describe:${entity}`);
      },
    });
    expect(exitCode).to.equal(0);
    expect(calls).to.deep.equal(['query:human:select 1', 'tables:dmo', 'describe:Account']);
    expect(await readFile(history, 'utf8')).to.equal('select 1\n');
    expect(text).to.include('data360[default]> ').and.include('Output format is csv.');
    expect(replHistoryPath({ XDG_CONFIG_HOME: '/tmp/xdg' }, '/home/test')).to.equal(
      join('/tmp/xdg', 'sf-data360', 'repl_history')
    );
  });

  it('renders REPL callback errors without active terminal controls', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-repl-terminal-safe-'));
    const output = new PassThrough();
    let text = '';
    output.on('data', (chunk) => {
      text += String(chunk);
    });
    await runRepl({
      dataSpace: 'default',
      input: Readable.from(['select 1;\n', '\\q\n']),
      output,
      historyPath: join(directory, 'history'),
      execute: async () => {
        throw new Error('remote\u001B[2Jerror\u0007');
      },
      listTables: async () => undefined,
      describe: async () => undefined,
    });
    expect(text).to.include('remote\\x1b[2Jerror\\x07');
    expect(text).not.to.include('\u001B').and.not.to.include('\u0007');
  });

  it('applies P6 REPL output, data-space, timing, include, expanded, and last controls', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-repl-p6-'));
    const include = join(directory, 'included.sql');
    await writeFile(include, 'select included');
    const output = new PassThrough();
    let text = '';
    output.on('data', (chunk) => {
      text += String(chunk);
    });
    const contexts: Array<{
      dataSpace: string;
      expanded: boolean;
      format: string;
      outputFile?: string;
      timing: boolean;
    }> = [];
    await runRepl({
      dataSpace: 'default',
      input: Readable.from([
        '\\f csv\n',
        '\\x\n',
        '\\o rows.csv\n',
        '\\dataspace analytics\n',
        '\\timing\n',
        `\\i ${include}\n`,
        '\\last\n',
        '\\q\n',
      ]),
      output,
      historyPath: join(directory, 'history'),
      execute: async (_sql, context) => {
        contexts.push(context);
        return 'query-123';
      },
      listTables: async () => undefined,
      describe: async () => undefined,
    });
    expect(contexts).to.deep.equal([
      {
        dataSpace: 'analytics',
        expanded: true,
        format: 'csv',
        outputFile: 'rows.csv',
        timing: true,
      },
    ]);
    expect(text).to.include('Last query ID: query-123').and.include('Data space is analytics.');
  });

  it('writes REPL history with mode 0600 and rejects symlink targets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-history-'));
    const history = join(directory, 'history');
    await writeFile(history, 'old\n', { mode: 0o644 });
    await chmod(history, 0o644);
    const output = new PassThrough();
    await runRepl({
      dataSpace: 'default',
      input: Readable.from(['select 1;\n', '\\q\n']),
      output,
      historyPath: history,
      execute: async () => undefined,
      listTables: async () => undefined,
      describe: async () => undefined,
    });
    if (process.platform !== 'win32') expect((await stat(history)).mode & 0o777).to.equal(0o600);

    const target = join(directory, 'target');
    const link = join(directory, 'link');
    await writeFile(target, '');
    await symlink(target, link);
    await assertRejects(
      runRepl({
        dataSpace: 'default',
        input: Readable.from(['select 2;\n']),
        output: new PassThrough(),
        historyPath: link,
        execute: async () => undefined,
        listTables: async () => undefined,
        describe: async () => undefined,
      }),
      'symbolic link'
    );
  });
});
