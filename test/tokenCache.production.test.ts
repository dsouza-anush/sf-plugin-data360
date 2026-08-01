import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import type { Connection } from '@salesforce/core';
import { TokenCache } from '../src/client/tokenCache.js';

describe('production token cache', () => {
  it('round-trips encrypted data with file mode 0600 in isolated state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-token-state-'));
    const cache = await TokenCache.create({
      rootFolder: directory,
      exchange: async () => ({
        jwt: 'production-jwt-secret',
        instanceUrl: 'https://tenant.c360a.salesforce.com',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        scopes: ['cdp_api'],
      }),
    });
    await cache.get('user@example.com', {} as Connection);
    await cache.close();

    const cachePath = join(directory, 'data360-token-cache.json');
    expect(await readFile(cachePath, 'utf8')).to.not.include('production-jwt-secret');
    if (process.platform !== 'win32') expect((await stat(cachePath)).mode & 0o777).to.equal(0o600);

    const reopened = await TokenCache.create({
      rootFolder: directory,
      exchange: async () => {
        throw new Error('warm encrypted cache should be reused');
      },
    });
    expect((await reopened.get('user@example.com', {} as Connection)).jwt).to.equal('production-jwt-secret');
    await reopened.close();
  });
});
