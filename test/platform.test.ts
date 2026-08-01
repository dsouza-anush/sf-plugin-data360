import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { expect } from 'chai';
import { Connection, Org } from '@salesforce/core';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import ApiRequest from '../src/commands/data360/api/request.js';
import Doctor from '../src/commands/data360/doctor.js';
import MetadataGet from '../src/commands/data360/metadata/get.js';
import MetadataList from '../src/commands/data360/metadata/list.js';
import Open from '../src/commands/data360/open.js';
import {
  executeRawRequest,
  RAW_BODY_MAX_BYTES,
  parseHeaders,
  resolveRawBody,
  resolveRawPath,
  responseHeaderBlock,
  writeResponseFile,
} from '../src/api/rawRequest.js';
import { runDoctorChecks } from '../src/doctor/checks.js';
import { createDoctorProgress } from '../src/doctor/progress.js';
import * as doctorHook from '../src/hooks/sf-doctor-data360.js';
import { MetadataClient } from '../src/metadata/client.js';
import { metadataFieldRows, metadataListRows } from '../src/metadata/output.js';
import { setBrowserLauncher } from '../src/open/browser.js';
import { routeFor } from '../src/open/routes.js';
import { assertRejects } from './helpers/async.js';
import { createCommandTestContext } from './helpers/command.js';
import { loadFixture } from './helpers/fixtures.js';
import { TokenCache } from '../src/client/tokenCache.js';

const require = createRequire(import.meta.url);
const entitiesFixture = loadFixture<{
  metadata: Array<{ name: string; displayName: string; category: string; type: string }>;
}>('metadata/entities.json');
const entityFixture = loadFixture<{
  metadata: Array<{
    name: string;
    fields: Array<{ name: string; type: string; businessType: string }>;
    primaryKeys: Array<{ name: string }>;
    relationships: unknown[];
  }>;
}>('metadata/entity.json');
const spacesFixture = loadFixture<{
  dataSpaces: Array<{ name: string }>;
}>('doctor/data-spaces.json');
const metadataPages = loadFixture<
  Array<{
    done: boolean;
    metadata: Array<{
      name: string;
      displayName: string;
      category: string;
      type: string;
      fields: Array<{ name: string }>;
    }>;
    nextPageUrl?: string;
  }>
>('metadata/pages.json');
const packageJson = require('../package.json') as {
  oclif: { hooks?: Record<string, string> };
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe('P1 platform commands', () => {
  const commandTest = createCommandTestContext();

  afterEach((): void => {
    process.exitCode = undefined;
    setBrowserLauncher(async (): Promise<void> => undefined);
  });

  it('maps live metadata shapes, filters defensively, and caps endpoint results client-side', async () => {
    const endpoints: string[] = [];
    const client = new MetadataClient({
      get: async <T>(endpoint: string): Promise<T> => {
        endpoints.push(endpoint);
        return entitiesFixture as T;
      },
    });
    const entities = await client.list({
      dataSpace: 'default',
      entityType: 'DataModelObject',
      entityCategory: 'Engagement',
      limit: 1,
      all: false,
    });
    expect(entities.map(({ name }) => name)).to.deep.equal(['ssot__SalesOrder__dlm']);
    expect(endpoints[0]).to.include('entityType=DataModelObject').and.include('entityCategory=Engagement');
    expect(metadataListRows(entities)[0]).to.deep.equal({
      name: 'ssot__SalesOrder__dlm',
      displayName: 'Sales Order',
      entityCategory: 'Engagement',
      entityType: 'DataModelObject',
      'fields#': undefined,
    });
  });

  it('uses full metadata by default and drains multi-page continuation only for --all', async () => {
    const endpoints: string[] = [];
    const client = new MetadataClient({
      get: async <T>(endpoint: string): Promise<T> => {
        endpoints.push(endpoint);
        return metadataPages[endpoints.length - 1] as T;
      },
    });
    const entities = await client.list({ dataSpace: 'default', limit: 100, all: true });
    expect(endpoints).to.deep.equal([
      '/metadata?dataspace=default',
      '/services/data/v67.0/ssot/metadata?dataspace=default&offset=1',
    ]);
    expect(metadataListRows(entities).map((row) => row['fields#'])).to.deep.equal([1, 2]);

    const repeated = new MetadataClient({
      get: async <T>(): Promise<T> => ({ done: false, metadata: [], nextPageUrl: '/metadata?dataspace=default' }) as T,
    });
    expect(
      (await assertRejects(repeated.list({ dataSpace: 'default', limit: 100, all: true }), 'repeated continuation'))
        .name
    ).to.equal('D360_API_ERROR');
  });

  it('drains nextBatchId and offset continuations from currentPageUrl', async () => {
    const endpoints: string[] = [];
    const responses = [
      {
        done: false,
        metadata: [metadataPages[0].metadata[0]],
        currentPageUrl: '/services/data/v67.0/ssot/metadata-entities?dataspace=default',
        nextBatchId: 'batch/2',
      },
      {
        done: false,
        metadata: [metadataPages[1].metadata[0]],
        currentPageUrl: '/services/data/v67.0/ssot/metadata-entities?dataspace=default&offset=2',
        offset: 2,
      },
      { done: true, metadata: [] },
    ];
    const client = new MetadataClient({
      get: async <T>(endpoint: string): Promise<T> => {
        endpoints.push(endpoint);
        return responses[endpoints.length - 1] as T;
      },
    });
    await client.list({ dataSpace: 'default', entityType: 'DataModelObject', limit: 100, all: true });
    expect(endpoints).to.deep.equal([
      '/metadata-entities?dataspace=default&entityType=DataModelObject',
      '/services/data/v67.0/ssot/metadata-entities?dataspace=default&nextBatchId=batch%2F2',
      '/services/data/v67.0/ssot/metadata-entities?dataspace=default&offset=3',
    ]);
  });

  it('gets exactly one entity and maps primary keys', async () => {
    const client = new MetadataClient({ get: async <T>(): Promise<T> => entityFixture as T });
    const entity = await client.get('ssot__Account__dlm', 'default');
    expect(metadataFieldRows(entity)[0]).to.deep.include({ name: 'ssot__Id__c', 'primaryKey?': true });
    const missing = new MetadataClient({ get: async <T>(): Promise<T> => ({ metadata: [] }) as T });
    expect((await assertRejects(missing.get('missing', 'default'))).name).to.equal('D360_NOT_FOUND');
    const ambiguous = new MetadataClient({
      get: async <T>(): Promise<T> => ({ metadata: [entityFixture.metadata[0], entityFixture.metadata[0]] }) as T,
    });
    expect((await assertRejects(ambiguous.get('Account', 'default'))).name).to.equal('D360_NAME_AMBIGUOUS');
  });

  it('executes metadata commands through real parsing and mocked connection boundaries', async () => {
    const org = new MockTestOrgData('metadata-commands');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> =>
      ((request as { url?: string }).url?.includes('metadata-entities') ? entitiesFixture : entityFixture) as never;

    const listed = await MetadataList.run([
      '--target-org',
      org.username,
      '--limit',
      '1',
      '--entity-type',
      'DataModelObject',
      '--json',
    ]);
    expect(listed.entities).to.have.length(1);
    const got = await MetadataGet.run(['--target-org', org.username, '--name', 'ssot__Account__dlm', '--json']);
    expect(got.name).to.equal('ssot__Account__dlm');
    const required = await assertRejects(MetadataGet.run(['--target-org', org.username]), 'Missing required flag');
    expect((required as { oclif?: { exit?: number } }).oclif?.exit).to.equal(2);
  });

  it('secures raw paths and headers and resolves every body source', async () => {
    expect(resolveRawPath('67.0', 'segments')).to.equal('/services/data/v67.0/ssot/segments');
    expect(resolveRawPath('67.0', '/services/data/v66.0/limits')).to.equal('/services/data/v66.0/limits');
    expect(() => resolveRawPath('67.0', 'https://evil.example/x')).to.throw('External');
    expect(() => resolveRawPath('67.0', '//evil.example/x')).to.throw('protocol-relative');
    expect(() => resolveRawPath('67.0', 'segments/../metadata')).to.throw('traversal');
    expect(() => resolveRawPath('67.0', 'segments/%2e%2e/metadata')).to.throw('traversal');
    expect(() => resolveRawPath('67.0', 'segments/%2E%2e%2fmetadata')).to.throw('traversal');
    expect(() => resolveRawPath('67.0', String.raw`segments\..\metadata`)).to.throw('traversal');
    expect(() => parseHeaders(['Authorization: stolen'])).to.throw('cannot be overridden');
    expect(() => parseHeaders(['Host: evil.example'])).to.throw('cannot be overridden');
    expect(() => parseHeaders(['Content-Length: 9'])).to.throw('cannot be overridden');
    expect(parseHeaders(['x-test: one', 'X-Other: two'])).to.deep.equal({ 'x-test': 'one', 'X-Other': 'two' });

    const directory = await mkdtemp(join(tmpdir(), 'data360-body-'));
    const file = join(directory, 'body.bin');
    await writeFile(file, Buffer.from([0, 1, 255]));
    expect(await resolveRawBody('literal')).to.deep.equal(Buffer.from('literal'));
    expect(await resolveRawBody(`@${file}`)).to.deep.equal(Buffer.from([0, 1, 255]));
    expect(await resolveRawBody('-', Readable.from([Buffer.from([3, 4])]))).to.deep.equal(Buffer.from([3, 4]));
    await assertRejects(resolveRawBody('-', Readable.from([Buffer.alloc(RAW_BODY_MAX_BYTES + 1)])), '10 MiB');
  });

  it('preserves raw bytes, includes response metadata, refreshes auth, and writes atomically', async () => {
    let refreshed = false;
    let clonedForTrace = false;
    let request: { url?: string; authorization?: string; body?: Uint8Array };
    const connection = {
      instanceUrl: 'https://org.example',
      accessToken: 'secret-token',
      refreshAuth: async () => {
        refreshed = true;
      },
    } as unknown as Connection;
    const response = await executeRawRequest(
      connection,
      { apiVersion: '67.0', endpoint: 'segments', method: 'POST', headers: ['x-test: value'], body: '\u0000raw' },
      async (input, init) => {
        request = {
          url: String(input),
          authorization: new Headers(init?.headers).get('authorization') ?? undefined,
          body: init?.body as Uint8Array,
        };
        const transportResponse = new Response(new Uint8Array([0, 255, 10]), {
          status: 418,
          statusText: 'Teapot',
          headers: { 'x-response': 'yes' },
        });
        Object.defineProperty(transportResponse, 'clone', {
          value: (): Response => {
            clonedForTrace = true;
            return transportResponse;
          },
        });
        return transportResponse;
      }
    );
    expect(refreshed).to.equal(true);
    expect(clonedForTrace).to.equal(false);
    expect(request!.url).to.equal('https://org.example/services/data/v67.0/ssot/segments');
    expect(request!.authorization).to.equal('Bearer secret-token');
    expect(Buffer.from(await response.arrayBuffer())).to.deep.equal(Buffer.from([0, 255, 10]));
    expect(responseHeaderBlock(response)).to.equal('HTTP 418 Teapot\nx-response: yes\n\n');
    const output = join(await mkdtemp(join(tmpdir(), 'data360-response-')), 'response.bin');
    await writeResponseFile(output, new Uint8Array([5, 6]));
    expect(await readFile(output)).to.deep.equal(Buffer.from([5, 6]));
  });

  it('uses real parser constraints for raw request and open', async () => {
    const org = new MockTestOrgData('platform-parser');
    await commandTest.context.stubAuths(org);
    const missingEndpoint = await assertRejects(
      ApiRequest.run(['--target-org', org.username]),
      'Missing 1 required arg'
    );
    expect((missingEndpoint as { oclif?: { exit?: number } }).oclif?.exit).to.equal(2);
    const exclusive = await assertRejects(
      Open.run(['--target-org', org.username, '--url-only', '--private']),
      'cannot also be provided'
    );
    expect((exclusive as { oclif?: { exit?: number } }).oclif?.exit).to.equal(2);
  });

  it('executes raw request through real parsing with exact response bytes and non-2xx status', async () => {
    const org = new MockTestOrgData('api-request-command');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (): Promise<never> => ({}) as never;
    const fetchStub = commandTest.context.SANDBOX.stub(globalThis, 'fetch').resolves(
      new Response(new Uint8Array([0, 254, 10]), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'x-error': 'yes' },
      })
    );
    const stdout = commandTest.context.SANDBOX.stub(process.stdout, 'write').returns(true);
    await ApiRequest.run([
      '--target-org',
      org.username,
      'segments',
      '--method',
      'POST',
      '--header',
      'content-type: application/octet-stream',
      '--body',
      'raw',
      '--no-prompt',
      '--include',
    ]);
    const requestUrl = String(fetchStub.firstCall.args[0]);
    expect(requestUrl).to.match(/\/services\/data\/v\d+\.\d+\/ssot\/segments$/u);
    const requestHeaders = new Headers(fetchStub.firstCall.args[1]?.headers);
    expect(requestHeaders.get('authorization')).to.match(/^Bearer .+/u);
    expect(stdout.firstCall.args[0]).to.equal('HTTP 400 Bad Request\nx-error: yes\n\n');
    expect(Buffer.from(stdout.secondCall.args[0] as Uint8Array)).to.deep.equal(Buffer.from([0, 254, 10]));
    expect(process.exitCode).to.equal(1);
  });

  it('passes redirect rejection to raw fetch and reports fetch timing only to stderr', async () => {
    const org = new MockTestOrgData('api-request-timing');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (): Promise<never> => ({}) as never;
    const fetchStub = commandTest.context.SANDBOX.stub(globalThis, 'fetch').resolves(
      new Response(undefined, { status: 302, statusText: 'Found' })
    );
    commandTest.context.SANDBOX.stub(process.stdout, 'write').returns(true);
    await ApiRequest.run(['--target-org', org.username, 'segments', '--timing']);
    expect(fetchStub.firstCall.args[1]?.redirect).to.equal('error');
    expect(process.exitCode).not.to.equal(1);
    expect(
      commandTest.ux.logToStderr
        .getCalls()
        .some(({ args }) =>
          /^Timing: parse [\d.]+ms · connection [\d.]+ms · request \d+ms · total [\d.]+ms$/u.test(String(args[0]))
        )
    ).to.equal(true);
  });

  it('writes formatted metadata rows for result-format JSON', async () => {
    const org = new MockTestOrgData('metadata-row-json');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (): Promise<never> => metadataPages[1] as never;
    const stdout = commandTest.context.SANDBOX.stub(process.stdout, 'write').returns(true);
    await MetadataList.run(['--target-org', org.username, '--result-format', 'json']);
    const rows = JSON.parse(String(stdout.firstCall.args[0])) as Array<Record<string, unknown>>;
    expect(rows[0]).to.deep.include({
      name: 'ssot__SalesOrder__dlm',
      entityCategory: 'Engagement',
      entityType: 'DataModelObject',
      'fields#': 2,
    });
  });

  it('builds frontdoor routes and never launches under JSON or url-only', async () => {
    const org = new MockTestOrgData('open-command');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Org, 'create').resolves({
      getUsername: () => org.username,
      getFrontDoorUrl: async (route: string) => `https://frontdoor.example?retURL=${encodeURIComponent(route)}`,
    } as unknown as Org);
    const launches: Array<{ url: string; privateMode: boolean }> = [];
    setBrowserLauncher(async (url, privateMode) => {
      launches.push({ url, privateMode });
    });
    const unsafeJson = await assertRejects(
      Open.run(['--target-org', org.username, '--path', 'segments', '--json']),
      'JSON output can expose a credential-bearing frontdoor URL.'
    );
    expect(unsafeJson.name).to.equal('D360_CONFIRMATION_REQUIRED');
    const json = await Open.run(['--target-org', org.username, '--path', 'segments', '--url-only', '--json']);
    expect(json.url).to.include(encodeURIComponent(routeFor('segments')));
    await Open.run(['--target-org', org.username, '--path', 'dmo', '--url-only']);
    expect(launches).to.deep.equal([]);
    await Open.run(['--target-org', org.username, '--path', 'home']);
    await Open.run(['--target-org', org.username, '--path', 'home', '--private']);
    expect(launches.map(({ privateMode }) => privateMode)).to.deep.equal([false, true]);
  });

  it('fails Direct doctor checks when P2 dependencies are unavailable', async () => {
    const endpoints: string[] = [];
    const passing = await runDoctorChecks({
      identity: async () => ({ username: 'user@example.com' }),
      maxApiVersion: async () => '67.0',
      request: async <T>(endpoint: string) => {
        endpoints.push(endpoint);
        return (endpoint === '/data-spaces' ? spacesFixture : { metadata: [] }) as T;
      },
      apiVersion: '67.0',
      dataSpace: 'default',
    });
    expect(passing.filter(({ status }) => status === 'fail')).to.have.length(3);
    expect(passing.map(({ name }) => name)).to.deep.equal([
      'Org authentication',
      'API version alignment',
      'Data 360 provisioning',
      'Data spaces',
      'Direct API token exchange',
      'Direct API ping',
      'Direct API scopes',
      'Configured data space',
    ]);
    expect(passing.filter(({ status }) => status === 'warn')).to.have.length(0);
    expect(endpoints).to.deep.equal(['/metadata', '/data-spaces']);
    const failing = await runDoctorChecks({
      identity: async () => {
        throw new Error('expired');
      },
      maxApiVersion: async () => '66.0',
      request: async (): Promise<never> => {
        throw new Error('not provisioned');
      },
      apiVersion: '67.0',
      dataSpace: 'missing',
    });
    expect(failing.some(({ name, status }) => name === 'Org authentication' && status === 'fail')).to.equal(true);
    expect(failing.at(-1)).to.deep.include({
      name: 'Configured data space',
      status: 'warn',
    });
    const fallback = await runDoctorChecks({
      identity: async () => ({ username: 'user@example.com' }),
      maxApiVersion: async () => '67.0',
      request: async <T>(endpoint: string) => {
        if (endpoint === '/metadata') throw new Error('metadata unavailable');
        return spacesFixture as T;
      },
      apiVersion: '67.0',
      dataSpace: 'default',
    });
    expect(fallback[2]).to.deep.include({
      name: 'Data 360 provisioning',
      status: 'pass',
    });
    expect(fallback[2].detail).to.include('fallback');
  });

  it('executes doctor through real parsing and mocked org boundaries', async () => {
    const org = new MockTestOrgData('doctor-command');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'identity').resolves({ username: org.username } as never);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'retrieveMaxApiVersion').resolves('67.0');
    const createCache = commandTest.context.SANDBOX.stub(TokenCache, 'create').resolves({
      get: commandTest.context.SANDBOX.stub().resolves({
        jwt: 'tenant-jwt-secret',
        instanceUrl: 'https://tenant.c360a.salesforce.com',
        expiresAt: '2026-07-10T01:00:00.000Z',
        scopes: ['cdp_api', 'cdp_query_api', 'cdp_profile_api', 'cdp_ingest_api'],
      }),
      close: commandTest.context.SANDBOX.stub().resolves(),
      invalidate: commandTest.context.SANDBOX.stub().resolves(),
    } as unknown as TokenCache);
    commandTest.context.SANDBOX.stub(globalThis, 'fetch').resolves(
      new Response(JSON.stringify({ metadata: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const endpoints: string[] = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const url = (request as { url?: string }).url ?? '';
      endpoints.push(url);
      return (url.includes('/data-spaces') ? spacesFixture : { metadata: [] }) as never;
    };
    const result = await Doctor.run(['--target-org', org.username, '--data-space', 'default', '--json']);
    expect(result.checks.filter(({ status }) => status === 'fail')).to.deep.equal([]);
    expect(result.checks.filter(({ status }) => status === 'warn')).to.have.length(0);
    expect(createCache.calledWithMatch({ bypass: true })).to.equal(true);
    expect(endpoints.filter((url) => url.includes('/ssot/'))).to.have.length(2);
  });

  it('exits 1 when fresh Direct doctor checks fail while SSOT remains available', async () => {
    const org = new MockTestOrgData('doctor-direct-failure');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'identity').resolves({ username: org.username } as never);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'retrieveMaxApiVersion').resolves('67.0');
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> =>
      ((request as { url?: string }).url?.includes('/data-spaces') ? spacesFixture : { metadata: [] }) as never;
    const createCache = commandTest.context.SANDBOX.stub(TokenCache, 'create').resolves({
      get: commandTest.context.SANDBOX.stub().rejects(new Error('the requested scope is not allowed')),
      close: commandTest.context.SANDBOX.stub().resolves(),
      invalidate: commandTest.context.SANDBOX.stub().resolves(),
    } as unknown as TokenCache);

    const result = await Doctor.run(['--target-org', org.username, '--data-space', 'default', '--json']);
    expect(createCache.calledWithMatch({ bypass: true })).to.equal(true);
    expect(result.checks.slice(4, 7).map(({ status }) => status)).to.deep.equal(['fail', 'fail', 'fail']);
    expect(process.exitCode).to.equal(1);
  });

  it('uses deterministic staged stderr fallback and suppresses it for JSON', () => {
    const messages: string[] = [];
    const fallback = createDoctorProgress({
      stages: ['Org authentication'],
      jsonEnabled: false,
      isTTY: false,
      log: (message) => messages.push(message),
    });
    fallback.report({ name: 'Org authentication', status: 'pass', detail: 'Authenticated' });
    fallback.stop();
    expect(messages).to.deep.equal(['[pass] Org authentication: Authenticated']);

    const suppressed = createDoctorProgress({
      stages: ['Org authentication'],
      jsonEnabled: true,
      isTTY: true,
      log: (message) => messages.push(message),
    });
    suppressed.report({ name: 'Org authentication', status: 'pass', detail: 'Authenticated' });
    suppressed.stop();
    expect(messages).to.have.length(1);
  });

  it('registers and handles the supported sf-doctor hook contract', async () => {
    expect(packageJson.oclif.hooks).to.deep.include({
      'sf-doctor-sf-plugin-data360': './lib/hooks/sf-doctor-data360',
    });
    expect(packageJson.dependencies).to.include.keys('@oclif/multi-stage-output');
    expect(packageJson.devDependencies).to.include.keys('@salesforce/plugin-info');
    const hook = (doctorHook as unknown as { hook?: (options: { doctor: unknown }) => Promise<void> }).hook;
    expect(hook).to.be.a('function');
    const pluginData: Array<{ plugin: string; data: unknown }> = [];
    const suggestions: string[] = [];
    const diagnostics: Array<{ testName: string; status: string }> = [];
    await hook?.({
      doctor: {
        addPluginData: (plugin: string, data: unknown): void => {
          pluginData.push({ plugin, data });
        },
        addSuggestion: (suggestion: string): void => {
          suggestions.push(suggestion);
        },
        addDiagnosticStatus: (diagnostic: { testName: string; status: string }): void => {
          diagnostics.push(diagnostic);
        },
      },
    });
    expect(pluginData).to.have.length(4);
    expect(pluginData.every(({ plugin }) => plugin === 'sf-plugin-data360')).to.equal(true);
    expect(diagnostics).to.have.length(4);
    expect(suggestions).to.have.length.greaterThan(0);
  });
});
