import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import { TokenCache, type TokenStorage } from '../src/client/tokenCache.js';
import { JobCache } from '../src/run/jobCache.js';
import { QueryJobCache } from '../src/run/queryJobCache.js';

describe('cache schema versioning', () => {
  it('migrates an unversioned token cache and self-heals corrupt contents', async () => {
    let contents = JSON.stringify({
      'legacy@example.com': {
        jwt: 'legacy-token',
        instanceUrl: 'https://tenant.c360a.salesforce.com',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    });
    const storage: TokenStorage = {
      read: async () => contents,
      write: async (value) => {
        contents = value;
      },
    };
    const connection = {} as Parameters<TokenCache['get']>[1];
    const cache = await TokenCache.create({
      storage,
      now: () => Date.parse('2026-07-11T00:00:00.000Z'),
      exchange: async () => ({
        jwt: 'fresh-token',
        instanceUrl: 'https://tenant.c360a.salesforce.com',
        expiresAt: '2099-01-02T00:00:00.000Z',
      }),
    });
    expect((await cache.get('legacy@example.com', connection)).jwt).to.equal('legacy-token');
    await cache.invalidate('legacy@example.com');
    expect(JSON.parse(contents)).to.deep.equal({ schemaVersion: 1, entries: {} });

    contents = '{damaged';
    const recovered = await TokenCache.create({
      storage,
      exchange: async () => ({
        jwt: 'recovered-token',
        instanceUrl: 'https://tenant.c360a.salesforce.com',
        expiresAt: '2099-01-03T00:00:00.000Z',
      }),
    });
    expect((await recovered.get('legacy@example.com', connection)).jwt).to.equal('recovered-token');
    expect(JSON.parse(contents).schemaVersion).to.equal(1);
  });

  it('migrates and recovers query-job caches', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-query-version-'));
    const path = join(directory, 'data360-query-jobs.json');
    const entry = {
      id: 'query-1',
      username: 'user@example.com',
      apiVersion: '67.0',
      dataSpace: 'default',
      submittedAt: '2026-07-11T00:00:00.000Z',
    };
    await writeFile(path, JSON.stringify({ [entry.id]: entry }));
    const cache = await QueryJobCache.create({
      rootFolder: directory,
      now: () => Date.parse('2026-07-11T00:00:01.000Z'),
    });
    expect((await cache.get(entry.id))?.username).to.equal('user@example.com');
    await cache.save({ ...entry, id: 'query-2' });
    expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).to.equal(1);

    await writeFile(path, '{damaged');
    const recovered = await QueryJobCache.create({ rootFolder: directory });
    expect(await recovered.get(entry.id)).to.equal(undefined);
  });

  it('supports an isolated query-cache directory for live scenarios and tests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-query-isolated-'));
    const cache = await QueryJobCache.create({
      environment: { SF_DATA360_QUERY_CACHE_DIR: directory },
    });
    await cache.save({
      id: 'isolated-query',
      username: 'user@example.com',
      apiVersion: '67.0',
      dataSpace: 'default',
      submittedAt: new Date().toISOString(),
    });

    expect(JSON.parse(await readFile(join(directory, 'data360-query-jobs.json'), 'utf8'))).to.have.nested.property(
      'entries.isolated-query.id',
      'isolated-query'
    );
  });

  it('discards structurally invalid entries from otherwise valid JSON envelopes', async () => {
    let tokenContents = JSON.stringify({
      schemaVersion: 1,
      entries: {
        'user@example.com': {
          jwt: 'stale-token',
          instanceUrl: 'https://tenant.c360a.salesforce.com',
          expiresAt: 'not-a-date',
        },
      },
    });
    const tokenStorage: TokenStorage = {
      read: async () => tokenContents,
      write: async (value) => {
        tokenContents = value;
      },
    };
    const tokenCache = await TokenCache.create({
      storage: tokenStorage,
      exchange: async () => ({
        jwt: 'fresh-token',
        instanceUrl: 'https://tenant.c360a.salesforce.com',
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
    });
    expect((await tokenCache.get('user@example.com', {} as Parameters<TokenCache['get']>[1])).jwt).to.equal(
      'fresh-token'
    );

    const directory = await mkdtemp(join(tmpdir(), 'data360-invalid-cache-'));
    await writeFile(
      join(directory, 'data360-query-jobs.json'),
      JSON.stringify({
        schemaVersion: 1,
        entries: {
          wrongKey: {
            id: 'different-id',
            username: 'user@example.com',
            apiVersion: '67.0',
            dataSpace: 'default',
            submittedAt: 'not-a-date',
          },
        },
      })
    );
    const queryCache = await QueryJobCache.create({ rootFolder: directory });
    expect(await queryCache.latest()).to.equal(undefined);

    await writeFile(
      join(directory, 'data360-ingest-jobs.json'),
      JSON.stringify({
        schemaVersion: 1,
        family: 'ingest',
        entries: {
          'job-1': {
            id: 'job-1',
            username: 'user@example.com',
            apiVersion: '67.0',
            startedAt: 'not-a-date',
          },
        },
      })
    );
    const ingestCache = await JobCache.create('ingest', { rootFolder: directory });
    expect(await ingestCache.latest()).to.equal(undefined);
  });

  it('migrates ingest-job caches and rejects envelopes for another family', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-ingest-version-'));
    const path = join(directory, 'data360-ingest-jobs.json');
    const entry = {
      id: 'job-1',
      username: 'user@example.com',
      apiVersion: '67.0',
      startedAt: '2026-07-11T00:00:00.000Z',
    };
    await writeFile(path, JSON.stringify({ [entry.id]: entry }));
    const cache = await JobCache.create('ingest', {
      rootFolder: directory,
      now: () => Date.parse('2026-07-11T00:00:01.000Z'),
    });
    expect((await cache.get(entry.id))?.username).to.equal('user@example.com');
    await cache.save({ ...entry, id: 'job-2' });
    expect(JSON.parse(await readFile(path, 'utf8'))).to.include({ schemaVersion: 1, family: 'ingest' });

    await writeFile(path, JSON.stringify({ schemaVersion: 1, family: 'query', entries: { [entry.id]: entry } }));
    const wrongFamily = await JobCache.create('ingest', { rootFolder: directory });
    expect(await wrongFamily.get(entry.id)).to.equal(undefined);
  });
});
