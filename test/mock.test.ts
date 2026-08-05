import { expect } from 'chai';
import type { FastifyInstance } from 'fastify';
import { Connection, type Connection as ConnectionType } from '@salesforce/core';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import { buildMockServer } from './mock/server.js';
import { TokenCache } from '../src/client/tokenCache.js';
import { exchangeConnection } from '../src/client/tokenExchange.js';
import { DirectClient } from '../src/client/directClient.js';
import { createCommandTestContext } from './helpers/command.js';
import TokenDisplay from '../src/commands/data360/token/display.js';
import ApiRequest from '../src/commands/data360/api/request.js';
import Doctor from '../src/commands/data360/doctor.js';
import { loadFixture } from './helpers/fixtures.js';

describe('mock NUT server', () => {
  const commandTest = createCommandTestContext();
  let server: FastifyInstance;
  let baseUrl: string;
  let exchangeRequests = 0;
  let previousNodeEnv: string | undefined;
  let previousTenantUrl: string | undefined;

  before(async () => {
    server = await buildMockServer();
    server.addHook('onRequest', async (request) => {
      if (request.url.startsWith('/services/a360/token')) exchangeRequests += 1;
    });
    baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  });

  beforeEach(() => {
    exchangeRequests = 0;
    previousNodeEnv = process.env.NODE_ENV;
    previousTenantUrl = process.env.SF_DATA360_TENANT_URL;
    process.env.NODE_ENV = 'test';
    process.env.SF_DATA360_TENANT_URL = baseUrl;
  });

  afterEach(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousTenantUrl === undefined) delete process.env.SF_DATA360_TENANT_URL;
    else process.env.SF_DATA360_TENANT_URL = previousTenantUrl;
    process.exitCode = undefined;
  });

  after(async () => {
    await server.close();
  });

  it('serves fixture routes over HTTP', async () => {
    const response = await fetch(`${baseUrl}/services/data/v67.0/ssot/metadata-entities`);
    const body = (await response.json()) as { metadata: unknown[]; synthetic?: boolean; __fixture?: unknown };
    expect(response.status).to.equal(200);
    expect(body.metadata.length).to.be.greaterThan(0);
    expect(body).not.to.have.property('synthetic');
    expect(body).not.to.have.property('__fixture');
  });

  it('injects deterministic rate limits', async () => {
    const response = await fetch(`${baseUrl}/services/data/v67.0/ssot/data-spaces?__mock429=1`);
    expect(response.status).to.equal(429);
    expect(response.headers.get('retry-after')).to.equal('0');
  });

  it('points the synthetic exchange and Direct metadata routes at itself', async () => {
    const exchange = await fetch(`${baseUrl}/services/a360/token`, { method: 'POST' });
    const token = (await exchange.json()) as { instance_url: string; access_token: string };
    expect(token.instance_url).to.equal(baseUrl);
    expect(token.access_token).to.equal('tenant-jwt-secret');
    const metadata = await fetch(`${token.instance_url}/api/v1/metadata`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    expect(metadata.status).to.equal(200);
    expect(await metadata.json()).to.have.property('metadata');
  });

  it('runs token exchange through the mock server into DirectClient transport', async () => {
    const env = { NODE_ENV: 'test', SF_DATA360_TENANT_URL: baseUrl };
    const connection = {
      instanceUrl: baseUrl,
      accessToken: 'core-token-secret',
      refreshAuth: async (): Promise<void> => undefined,
    } as unknown as ConnectionType;
    const cache = await TokenCache.create({
      bypass: true,
      env,
      exchange: async (value) => exchangeConnection(value, { env }),
    });
    try {
      const client = new DirectClient({
        username: 'mock@example.com',
        connection,
        cache,
        useCache: false,
        env,
      });
      const response = await client.get<{ metadata: Array<{ name: string }> }>('metadata');
      expect(response.metadata[0].name).to.equal('ssot__Individual__dlm');
    } finally {
      await cache.close();
    }
  });

  it('executes token display through real parsing and the mock exchange route without logging the JWT', async () => {
    const org = new MockTestOrgData('mock-token-command');
    org.instanceUrl = baseUrl;
    org.loginUrl = baseUrl;
    await commandTest.context.stubAuths(org);

    const result = await TokenDisplay.run(['--target-org', org.username, '--no-token-cache', '--json']);
    expect(result.instanceUrl).to.equal(baseUrl);
    expect(result.accessToken).to.have.length.greaterThan(0);
    expect(commandTest.ux.logSensitive.called).to.equal(false);
    expect(exchangeRequests).to.equal(1);
    expect(process.exitCode).not.to.equal(1);
  });

  it('executes api request --direct through real parsing and mock tenant transport', async () => {
    const org = new MockTestOrgData('mock-api-command');
    org.instanceUrl = baseUrl;
    org.loginUrl = baseUrl;
    await commandTest.context.stubAuths(org);
    const stdout = commandTest.context.SANDBOX.stub(process.stdout, 'write').returns(true);

    await ApiRequest.run(['--target-org', org.username, 'metadata', '--direct', '--no-token-cache']);
    const body = JSON.parse(Buffer.from(stdout.firstCall.args[0] as Uint8Array).toString()) as {
      metadata: Array<{ name: string }>;
    };
    expect(body.metadata[0].name).to.equal('ssot__Individual__dlm');
    expect(JSON.stringify(body)).to.not.include('tenant-jwt-secret');
    expect(exchangeRequests).to.equal(1);
    expect(process.exitCode).not.to.equal(1);
  });

  it('executes doctor with one fresh exchange reused by the mock Direct ping', async () => {
    const org = new MockTestOrgData('mock-doctor-command');
    org.instanceUrl = baseUrl;
    org.loginUrl = baseUrl;
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'identity').resolves({ username: org.username } as never);
    commandTest.context.SANDBOX.stub(Connection.prototype, 'retrieveMaxApiVersion').resolves('67.0');
    const spaces = loadFixture<{ dataSpaces: Array<{ name: string }> }>('doctor/data-spaces.json');
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> =>
      ((request as { url?: string }).url?.includes('/data-spaces') ? spaces : { metadata: [] }) as never;

    const result = await Doctor.run(['--target-org', org.username, '--data-space', 'default', '--json']);
    expect(result.checks.slice(4, 7).map(({ status }) => status)).to.deep.equal(['pass', 'pass', 'pass']);
    expect(exchangeRequests).to.equal(1);
    expect(process.exitCode).not.to.equal(1);
  });
});
