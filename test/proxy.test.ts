import { expect } from 'chai';
import type { Connection } from '@salesforce/core';
import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { executeRawDirectRequest, executeRawRequest } from '../src/api/rawRequest.js';
import { DirectClient } from '../src/client/directClient.js';
import { createProxyAwareFetch, inspectProxyEnvironment, shouldBypassProxy } from '../src/client/proxyFetch.js';
import type { TokenCache } from '../src/client/tokenCache.js';
import { exchangeConnection } from '../src/client/tokenExchange.js';
import { assertRejects } from './helpers/async.js';

const listen = async (server: Server): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });

const close = async (server: Server): Promise<void> => {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
};

describe('enterprise proxy transport', () => {
  it('uses lowercase precedence and enforces redirect rejection on injected fetch implementations', async () => {
    expect(
      inspectProxyEnvironment({
        http_proxy: '',
        HTTP_PROXY: 'http://uppercase.invalid:8080',
        https_proxy: 'http://lowercase.invalid:8080',
        HTTPS_PROXY: 'http://uppercase.invalid:8443',
        no_proxy: '',
        NO_PROXY: 'secret.internal',
      })
    ).to.deep.equal({
      enabled: true,
      httpProxyConfigured: false,
      httpsProxyConfigured: true,
      noProxyConfigured: false,
    });

    let receivedInit: RequestInit | undefined;
    const transport = createProxyAwareFetch({
      env: { HTTPS_PROXY: 'http://proxy-user:proxy-secret@proxy.invalid:8443' },
      fetch: async (_input, init): Promise<Response> => {
        receivedInit = init;
        return new Response('injected');
      },
    });
    expect(await (await transport.fetch('https://tenant.example', { method: 'GET' })).text()).to.equal('injected');
    expect(Object.hasOwn(receivedInit ?? {}, 'dispatcher')).to.equal(false);
    expect(receivedInit?.redirect).to.equal('error');
    await transport.close();
  });

  it('matches explicit NO_PROXY host, suffix, wildcard, IPv6, and port rules', () => {
    expect(shouldBypassProxy(new URL('https://api.example.com'), '.example.com')).to.equal(true);
    expect(shouldBypassProxy(new URL('https://api.example.com'), '*.example.com')).to.equal(true);
    expect(shouldBypassProxy(new URL('https://api.example.com'), 'example.com')).to.equal(false);
    expect(shouldBypassProxy(new URL('https://example.com'), 'example.com:443')).to.equal(true);
    expect(shouldBypassProxy(new URL('https://example.com'), 'example.com:8443')).to.equal(false);
    expect(shouldBypassProxy(new URL('http://[::1]:8080'), '[::1]:8080')).to.equal(true);
    expect(shouldBypassProxy(new URL('https://anything.invalid'), '*')).to.equal(true);
  });

  it('routes token, Direct, and raw requests through a local proxy and honors NO_PROXY', async () => {
    const targetProxyAuthorization: Array<string | undefined> = [];
    let targetOrigin = '';
    const target = createServer((request, response) => {
      targetProxyAuthorization.push(request.headers['proxy-authorization']);
      response.setHeader('content-type', 'application/json');
      if (request.url === '/services/a360/token') {
        response.end(
          JSON.stringify({
            access_token: 'tenant-jwt-secret',
            instance_url: targetOrigin,
            expires_in: 3600,
            scope: 'cdp_api',
          })
        );
        return;
      }
      response.end(JSON.stringify({ ok: true, path: request.url }));
    });

    const proxySockets = new Set<Socket>();
    const proxyConnections = new Set<Socket>();
    const proxyAuthorizations: Array<string | undefined> = [];
    const proxyWarnings: Error[] = [];
    const onWarning = (warning: Error & { code?: string }): void => {
      if (warning.code === 'UNDICI-EHPA') proxyWarnings.push(warning);
    };
    let proxyConnects = 0;
    const proxy = createServer();
    proxy.on('connection', (socket) => {
      proxyConnections.add(socket);
      socket.once('close', () => proxyConnections.delete(socket));
    });
    proxy.on('connect', (request, clientSocket, head) => {
      proxyConnects += 1;
      proxyAuthorizations.push(request.headers['proxy-authorization']);
      const [hostname, port] = (request.url ?? '').split(':');
      const upstream = connect(Number(port), hostname);
      proxySockets.add(upstream);
      upstream.once('connect', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.once('close', () => proxySockets.delete(upstream));
      upstream.once('error', () => clientSocket.destroy());
    });

    process.on('warning', onWarning);
    try {
      const targetPort = await listen(target);
      targetOrigin = `http://127.0.0.1:${targetPort}`;
      const proxyPort = await listen(proxy);
      const proxyUrl = `http://proxy-user:proxy-secret@127.0.0.1:${proxyPort}`;
      const env = {
        NODE_ENV: 'test',
        SF_DATA360_TENANT_URL: targetOrigin,
        HTTP_PROXY: proxyUrl,
      };
      const connection = {
        instanceUrl: targetOrigin,
        accessToken: 'core-token-secret',
        refreshAuth: async (): Promise<void> => undefined,
      } as unknown as Connection;

      const token = await exchangeConnection(connection, { env, now: () => 0 });
      expect(token).to.deep.include({ jwt: 'tenant-jwt-secret', instanceUrl: targetOrigin });

      const cache = {
        get: async () => token,
        invalidate: async (): Promise<void> => undefined,
      } as unknown as TokenCache;
      const direct = new DirectClient({
        username: 'user@example.com',
        connection,
        cache,
        token,
        env,
      });
      expect(await direct.get('/api/v1/metadata')).to.deep.include({ ok: true, path: '/api/v1/metadata' });

      const rawDirect = await executeRawDirectRequest(connection, cache, {
        username: 'user@example.com',
        endpoint: '/api/v1/metadata',
        method: 'GET',
        headers: [],
        env,
      });
      expect(await rawDirect.json()).to.deep.include({ ok: true, path: '/api/v1/metadata' });
      expect(proxyConnects).to.be.greaterThanOrEqual(3);
      expect(proxyAuthorizations).to.have.length.greaterThanOrEqual(3);
      expect(proxyAuthorizations.every((value) => value?.startsWith('Basic '))).to.equal(true);
      expect(targetProxyAuthorization.every((value) => value === undefined)).to.equal(true);

      const connectsBeforeBypass = proxyConnects;
      const bypassed = await executeRawRequest(connection, {
        apiVersion: '67.0',
        endpoint: 'proxy-proof',
        method: 'GET',
        headers: [],
        env: { ...env, NO_PROXY: '127.0.0.1' },
      });
      expect(await bypassed.json()).to.deep.include({ ok: true });
      expect(proxyConnects).to.equal(connectsBeforeBypass);

      const diagnostics = JSON.stringify(inspectProxyEnvironment(env));
      expect(diagnostics).to.not.include('proxy-user').and.not.include('proxy-secret').and.not.include(proxyUrl);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(proxyWarnings).to.be.empty;
    } finally {
      process.off('warning', onWarning);
      for (const socket of proxySockets) socket.destroy();
      for (const socket of proxyConnections) socket.destroy();
      await Promise.all([close(proxy), close(target)]);
    }
  });

  it('preserves AbortError identity and valid-proxy network failures', async () => {
    const unavailable = createServer();
    const unavailablePort = await listen(unavailable);
    await close(unavailable);
    const transport = createProxyAwareFetch({
      env: { HTTP_PROXY: `http://127.0.0.1:${unavailablePort}` },
    });
    try {
      const controller = new AbortController();
      const abort = new DOMException('request stopped', 'AbortError');
      controller.abort(abort);
      const aborted = await assertRejects(
        transport.fetch('http://target.invalid/abort', { signal: controller.signal })
      );
      expect(aborted).to.equal(abort);

      const network = await assertRejects(transport.fetch('http://target.invalid/network'));
      expect(network.name).to.not.equal('D360_API_ERROR');
      expect((network as Error & { cause?: { code?: string } }).cause?.code).to.equal('ECONNREFUSED');
    } finally {
      await transport.close();
    }
  });

  it('does not expose credentialed proxy URLs in configuration errors', async () => {
    const transport = createProxyAwareFetch({
      env: { HTTP_PROXY: 'http://proxy-user:proxy-secret@' },
    });
    const error = await assertRejects(transport.fetch('http://127.0.0.1:1'));
    expect(error.name).to.equal('D360_API_ERROR');
    expect(JSON.stringify(error)).to.not.include('proxy-user').and.not.include('proxy-secret');
    await transport.close();
  });
});
