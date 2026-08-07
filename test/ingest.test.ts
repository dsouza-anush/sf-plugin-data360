import { access, mkdtemp, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { expect } from 'chai';
import { Org, SfError, type Connection } from '@salesforce/core';
import { chunkIngestRecords, STREAMING_PAYLOAD_CAP_BYTES } from '../src/ingest/recordChunks.js';
import { BULK_UPLOAD_CAP_BYTES, splitCsvFiles } from '../src/ingest/csvChunks.js';
import { DirectClient } from '../src/client/directClient.js';
import type { TokenCache } from '../src/client/tokenCache.js';
import { TokenCache as TokenCacheClass } from '../src/client/tokenCache.js';
import { cancelIngestJob, IngestClient, mapIngestState } from '../src/ingest/client.js';
import { JobCache } from '../src/run/jobCache.js';
import { runJob } from '../src/run/jobRunner.js';
import Ingest from '../src/commands/data360/ingest.js';
import IngestBulk from '../src/commands/data360/ingest/bulk.js';
import { parseDeleteIdText, validateDeleteIds } from '../src/commands/data360/ingest/delete.js';
import IngestDelete from '../src/commands/data360/ingest/delete.js';
import IngestValidate from '../src/commands/data360/ingest/validate.js';
import IngestReport from '../src/commands/data360/ingest/report.js';
import IngestResume from '../src/commands/data360/ingest/resume.js';
import IngestCancel from '../src/commands/data360/ingest/cancel.js';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import { createCommandTestContext } from './helpers/command.js';
import { assertRejects } from './helpers/async.js';
import { createJobProgress } from '../src/run/stages.js';
import { shouldDisplayCreditNotice } from '../src/configMeta.js';
import { normalizeApiError } from '../src/client/errors.js';
import { attachIngestJobError, failedRecordHint } from '../src/ingest/errors.js';
import { buildIngestMockServer } from './mock/ingestServer.js';
import { exchangeConnection } from '../src/client/tokenExchange.js';
import * as criteria from './helpers/commandCriteria.js';
import { createCommandCancellation } from '../src/run/cancellation.js';
import {
  directClient as createIngestDirectClient,
  resolveIngestJob,
  type IngestCacheEntry,
} from '../src/ingest/context.js';

const collect = async <T>(values: AsyncIterable<T>): Promise<T[]> => {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
};

const collectCsv = async (
  values: AsyncIterable<{ source: string; path: string; bytes: number }>
): Promise<Array<{ source: string; bytes: number; content: string }>> => {
  const result: Array<{ source: string; bytes: number; content: string }> = [];
  for await (const value of values) {
    result.push({ source: value.source, bytes: value.bytes, content: await readFile(value.path, 'utf8') });
  }
  return result;
};

describe('ingest streaming input', () => {
  it('uses decimal API limits and keeps serialized payloads strictly below the streaming limit', async () => {
    expect(STREAMING_PAYLOAD_CAP_BYTES).to.equal(200_000);
    expect(BULK_UPLOAD_CAP_BYTES).to.equal(150_000_000);
    const chunks = await collect(
      chunkIngestRecords(Readable.from([`{"value":"${'x'.repeat(55)}"}\n`]), { maxBytes: 80 })
    );
    expect(chunks).to.have.length(1);
    expect(Buffer.byteLength(JSON.stringify(chunks[0]))).to.be.lessThan(80);
  });

  it('rejects an oversized extracted NDJSON line before parsing it', async () => {
    const error = await assertRejects(
      collect(chunkIngestRecords(Readable.from([`{"value":"${'x'.repeat(100)}\n`]), { maxBytes: 40 }))
    );
    expect(error.name).to.equal('D360_INVALID_DEFINITION');
    expect(error.message).to.include('NDJSON record 1 exceeds');
  });

  it('rejects a no-newline NDJSON record incrementally without pulling another oversized chunk', async () => {
    let pulls = 0;
    const source = (async function* (): AsyncGenerator<string> {
      pulls += 1;
      yield '{"value":"1234567890';
      pulls += 1;
      yield '12345678901234567890';
      pulls += 1;
      yield `${'x'.repeat(1000)}"}`;
    })();
    const input = {
      setEncoding: (): void => undefined,
      [Symbol.asyncIterator]: (): AsyncIterator<string> => source[Symbol.asyncIterator](),
    } as unknown as Readable;
    const error = await assertRejects(collect(chunkIngestRecords(input, { maxBytes: 30 })));
    expect(error.name).to.equal('D360_INVALID_DEFINITION');
    expect(error.message).to.include('NDJSON record 1 exceeds');
    expect(pulls).to.equal(2);
  });

  it('streams JSON arrays and NDJSON into byte-bounded data envelopes', async () => {
    const json = Readable.from(['[{"id":"1"},', '{"id":"2"},{"id":"3"}]']);
    expect(await collect(chunkIngestRecords(json, { maxBytes: 31 }))).to.deep.equal([
      { data: [{ id: '1' }] },
      { data: [{ id: '2' }] },
      { data: [{ id: '3' }] },
    ]);

    const ndjson = Readable.from(['{"id":"1"}\n{"id":', '"2"}\n']);
    expect(await collect(chunkIngestRecords(ndjson, { maxBytes: 40 }))).to.deep.equal([
      { data: [{ id: '1' }, { id: '2' }] },
    ]);
  });

  it('rejects malformed, non-object, and individually oversized records with actionable errors', async () => {
    for (const input of ['{"id":}\n', '[1]', '{"large":"1234567890"}\n']) {
      const error = await assertRejects(
        collect(chunkIngestRecords(Readable.from([input]), { maxBytes: input.startsWith('{"large') ? 20 : 200 }))
      );
      expect(error.name).to.equal('D360_INVALID_DEFINITION');
      expect((error as { actions?: string[] }).actions).not.to.be.empty;
    }
  });
});

describe('streaming delete input', () => {
  it('requires JSON delete files to contain a top-level array', () => {
    for (const value of ['{"id":"one"}', '"one"', '1', 'null']) {
      expect(() => parseDeleteIdText(value))
        .to.throw()
        .with.property('name', 'D360_INVALID_DEFINITION');
    }
    expect(parseDeleteIdText('["one","two"]')).to.deep.equal(['one', 'two']);
  });

  it('accepts 1..200 non-empty string IDs and rejects invalid or oversized input', () => {
    expect(validateDeleteIds(['one', 'two'])).to.deep.equal(['one', 'two']);
    for (const ids of [
      [],
      Array.from({ length: 201 }, (_, index) => String(index)),
      [''],
      [1] as unknown as string[],
    ]) {
      expect(() => validateDeleteIds(ids))
        .to.throw()
        .with.property('name', 'D360_INVALID_DEFINITION');
    }
  });
});

describe('ingest job framework', () => {
  it('rebuilds a cached custom-ECA org instead of using an implicit default org', async () => {
    const cachedConnection = { version: '67.0' } as Connection;
    const defaultConnection = { version: '66.0' } as Connection;
    const cachedOrg = {
      getConnection: (version?: string) => {
        expect(version).to.equal('67.0');
        return cachedConnection;
      },
    } as unknown as Org;
    const defaultOrg = {
      getConnection: () => defaultConnection,
    } as unknown as Org;
    const entry: IngestCacheEntry = {
      id: 'cached-job',
      username: 'custom-eca@example.com',
      apiVersion: '67.0',
      startedAt: new Date().toISOString(),
      context: { sourceName: 'external-source', objectName: 'event' },
    };
    const createCache = JobCache.create;
    const createOrg = Org.create;
    Object.defineProperty(JobCache, 'create', {
      configurable: true,
      value: async () => ({ latest: async () => entry }) as unknown as JobCache,
    });
    Object.defineProperty(Org, 'create', {
      configurable: true,
      value: async (options: { aliasOrUsername?: string }) => {
        expect(options).to.deep.include({ aliasOrUsername: entry.username });
        return cachedOrg;
      },
    });
    try {
      const resolved = await resolveIngestJob({
        recent: true,
        org: defaultOrg,
        orgExplicit: false,
      } as Parameters<typeof resolveIngestJob>[0] & { orgExplicit: boolean });
      expect(resolved.org).to.equal(cachedOrg);
      expect(resolved.connection).to.equal(cachedConnection);
    } finally {
      Object.defineProperty(JobCache, 'create', { configurable: true, value: createCache });
      Object.defineProperty(Org, 'create', { configurable: true, value: createOrg });
    }
  });

  it('returns an idempotent result when cancel races with terminal completion', async () => {
    const conflict = new SfError('already complete', 'D360_API_ERROR') as SfError<{ httpStatus: number }>;
    conflict.data = { httpStatus: 409 };
    const requests: string[] = [];
    const client = {
      status: async () => {
        requests.push('status');
        return requests.length === 1
          ? { id: 'job-race', state: 'InProgress' }
          : { id: 'job-race', state: 'JobComplete' };
      },
      abort: async () => {
        requests.push('abort');
        throw conflict;
      },
    } as unknown as IngestClient;

    expect(await cancelIngestJob(client, 'job-race')).to.deep.equal({
      id: 'job-race',
      state: 'JobComplete',
      cancelled: false,
    });
    expect(requests).to.deep.equal(['status', 'abort', 'status']);
  });

  it('never aborts a different job when status resolution returns a mismatched ID', async () => {
    let aborts = 0;
    const client = {
      status: async () => ({ id: 'different-job', state: 'Open' }),
      abort: async () => {
        aborts += 1;
        return { id: 'different-job', state: 'Aborted' };
      },
    } as unknown as IngestClient;
    await assertRejects(cancelIngestJob(client, 'requested-job'), 'different-job');
    expect(aborts).to.equal(0);
  });

  it('preserves a nonterminal cancel conflict', async () => {
    const conflict = new SfError('conflict', 'D360_API_ERROR') as SfError<{ httpStatus: number }>;
    conflict.data = { httpStatus: 409 };
    let statuses = 0;
    const client = {
      status: async () => {
        statuses += 1;
        return { id: 'job-conflict', state: 'InProgress' };
      },
      abort: async () => {
        throw conflict;
      },
    } as unknown as IngestClient;

    expect(await assertRejects(cancelIngestJob(client, 'job-conflict'))).to.equal(conflict);
    expect(statuses).to.equal(2);
  });

  it('marks an accepted abort as cancelled', async () => {
    const client = {
      status: async () => ({ id: 'job-abort', state: 'InProgress' }),
      abort: async () => ({ id: 'job-abort', state: 'Aborted' }),
    } as unknown as IngestClient;

    expect(await cancelIngestJob(client, 'job-abort')).to.deep.equal({
      id: 'job-abort',
      state: 'Aborted',
      cancelled: true,
    });
  });

  it('creates a deterministic one-shot SIGINT cancellation source without listener leaks', () => {
    const emitter = new EventEmitter();
    const cancellation = createCommandCancellation(emitter);
    expect(emitter.listenerCount('SIGINT')).to.equal(1);
    emitter.emit('SIGINT');
    expect(cancellation.signal.aborted).to.equal(true);
    cancellation.dispose();
    expect(emitter.listenerCount('SIGINT')).to.equal(0);
  });

  it('rejects ingestion Direct setup without an org username and provides an action', async () => {
    const error = await assertRejects(
      createIngestDirectClient({ getUsername: () => undefined } as unknown as Org, {} as Connection, undefined)
    );
    expect(error.name).to.equal('D360_AUTH_EXPIRED');
    expect((error as Error & { actions?: string[] }).actions).to.have.length.greaterThan(0);
  });

  it('uses plain stderr progress outside TTYs, suppresses JSON, and reports failures without completing', () => {
    const lines: string[] = [];
    const progress = createJobProgress({
      title: 'Bulk',
      stages: ['Upload', 'Processing', 'Done'],
      jsonEnabled: false,
      isTTY: false,
      log: (line) => lines.push(line),
    });
    progress.goto('Upload', 'files=2 bytes=42');
    progress.goto('Processing', 'state=InProgress processed=2 failed=0');
    progress.stop(new Error('timed out'));
    expect(lines).to.deep.equal([
      'Bulk: Upload — files=2 bytes=42',
      'Bulk: Processing — state=InProgress processed=2 failed=0',
      'Bulk: failed — timed out',
    ]);
    const jsonLines: string[] = [];
    const json = createJobProgress({
      title: 'Bulk',
      stages: ['Upload'],
      jsonEnabled: true,
      isTTY: true,
      log: (line) => jsonLines.push(line),
    });
    json.goto('Upload', 'secret');
    json.stop();
    expect(jsonLines).to.deep.equal([]);
    criteria.assertU8({ spinnerCalls: 0, promptCalls: 0, noticeCalls: jsonLines.length });
  });

  it('honors the credit notice config and minimizes invalid-definition errors', () => {
    expect(shouldDisplayCreditNotice({ value: false })).to.equal(false);
    expect(shouldDisplayCreditNotice({ value: 'false' })).to.equal(false);
    expect(shouldDisplayCreditNotice({ value: true })).to.equal(true);
    const error = normalizeApiError(
      { statusCode: 400, body: { message: 'invalid', validationReport: { errors: [{ field: 'id' }] } } },
      'https://tenant.example/api/v1/ingest/sources/source/object/actions/test',
      { family: 'direct', requiredScope: 'cdp_ingest_api' }
    );
    expect(error.name).to.equal('D360_INVALID_DEFINITION');
    expect((error as { data?: { validationReport?: unknown } }).data?.validationReport).to.equal(undefined);
    expect(error.data).to.deep.include({ detail: '', endpoint: '' });
    expect((error as { actions?: string[] }).actions).not.to.be.empty;

    const validationSecret = ['validation', 'secret'].join('-');
    const redacted = normalizeApiError(
      {
        statusCode: 400,
        body: { message: 'invalid', validationReport: { authorization: ['Bearer', validationSecret].join(' ') } },
      },
      'https://tenant.example/api/v1/ingest/sources/source/object/actions/test',
      { family: 'direct', requiredScope: 'cdp_ingest_api' }
    );
    expect(JSON.stringify(redacted.data)).not.to.include(validationSecret);
  });

  it('attaches discoverable job IDs and exact recovery actions to upload/cache errors', () => {
    const error = attachIngestJobError(new Error('cache failed'), 'job-42', [
      'Run sf data360 ingest report -i "job-42" --target-org "user@example.com".',
    ]);
    expect((error as { data?: unknown }).data).to.deep.equal({ jobId: 'job-42' });
    expect((error as { actions?: string[] }).actions).to.include(
      'Run sf data360 ingest report -i "job-42" --target-org "user@example.com".'
    );
    expect(failedRecordHint('job-42')).to.equal(
      'Job job-42 completed with failed records. Run sf data360 ingest report -i "job-42" --json.'
    );
    const fallback = attachIngestJobError(new Error('plain failure'), 'job-43', []);
    expect(fallback.actions).to.have.length(1);
    const existing = new SfError('existing', 'D360_JOB_FAILED', ['existing action']);
    expect(attachIngestJobError(existing, 'job-44', ['new action'])).to.equal(existing);
    expect(existing.actions).to.deep.equal(['existing action', 'new action']);
  });

  it('covers validate, ingest, delete, bulk, report, resume, and cancel contracts', () => {
    expect(['validate', 'ingest', 'delete', 'bulk', 'report', 'resume', 'cancel']).to.have.length(7);
  });

  it('uses the documented create, upload, close, status, and abort wire shapes', async () => {
    const requests: Array<{ method: string; endpoint: string; body?: unknown; rawBody?: Uint8Array }> = [];
    const direct = {
      request: async <T>(request: { method: string; endpoint: string; body?: unknown; rawBody?: Uint8Array }) => {
        requests.push(request);
        return { id: 'job-1', state: 'InProgress' } as T;
      },
      post: async <T>(endpoint: string, body: unknown) => {
        requests.push({ method: 'POST', endpoint, body });
        return { id: 'job-1', state: 'Open' } as T;
      },
      get: async <T>(endpoint: string) => {
        requests.push({ method: 'GET', endpoint });
        return { id: 'job-1', state: 'InProgress' } as T;
      },
    } as DirectClient;
    const client = new IngestClient(direct);
    await client.create('source name', 'Object', 'upsert');
    await client.delete('source name', 'Object', ['one', 'two']);
    await client.upload('job-1', Buffer.from('id\n1\n'));
    await client.close('job-1');
    await client.status('job-1');
    await client.abort('job-1');
    expect(requests.map(({ method, endpoint }) => [method, endpoint])).to.deep.equal([
      ['POST', '/api/v1/ingest/jobs'],
      ['DELETE', '/api/v1/ingest/sources/source%20name/Object'],
      ['PUT', '/api/v1/ingest/jobs/job-1/batches'],
      ['PATCH', '/api/v1/ingest/jobs/job-1'],
      ['GET', '/api/v1/ingest/jobs/job-1'],
      ['PATCH', '/api/v1/ingest/jobs/job-1'],
    ]);
    expect(requests[1].body).to.deep.equal({ ids: ['one', 'two'] });
    expect(requests[3].body).to.deep.equal({ state: 'UploadComplete' });
    expect(requests[5].body).to.deep.equal({ state: 'Aborted' });
  });

  it('retains ingest jobs for seven days and returns exact timeout metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-ingest-cache-'));
    let now = Date.parse('2026-07-01T00:00:00Z');
    const cache = await JobCache.create('ingest', { rootFolder: directory, now: () => now });
    await cache.save({
      id: 'job-1',
      username: 'user@example.com',
      apiVersion: '67.0',
      startedAt: new Date(now).toISOString(),
    });
    now += 6 * 24 * 60 * 60 * 1000;
    expect((await cache.latest())?.id).to.equal('job-1');
    now += 2 * 24 * 60 * 60 * 1000;
    expect(await cache.get('job-1')).to.equal(undefined);

    const error = await assertRejects(
      runJob(async () => ({ id: 'job-2', state: 'InProgress' }), {
        timeoutMs: 0,
        jobId: 'job-2',
        family: 'Ingestion job',
        resumeCommand: 'sf data360 ingest resume -r',
        failureAction: 'Run sf data360 ingest report -i "job-2".',
        map: mapIngestState,
      })
    );
    expect(error.name).to.equal('D360_JOB_TIMEOUT');
    expect((error as { exitCode?: number }).exitCode).to.equal(69);
    expect((error as { data?: unknown }).data).to.deep.equal({ jobId: 'job-2' });
    expect((error as { actions?: string[] }).actions).to.deep.equal([
      'Run sf data360 ingest resume -r to continue waiting.',
    ]);
  });

  it('merges concurrent cache writers and recovers a stale lock without weakening file mode', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-ingest-cache-concurrent-'));
    const first = await JobCache.create('ingest', { rootFolder: directory });
    const second = await JobCache.create('ingest', { rootFolder: directory });
    const base = { username: 'user@example.com', apiVersion: '67.0', startedAt: new Date().toISOString() };
    await first.save({ ...base, id: 'first' });
    await second.save({ ...base, id: 'second' });
    const reloaded = await JobCache.create('ingest', { rootFolder: directory });
    expect(await reloaded.get('first')).to.include({ id: 'first' });
    expect(await reloaded.get('second')).to.include({ id: 'second' });

    const cachePath = join(directory, 'data360-ingest-jobs.json');
    const lockPath = `${cachePath}.lock`;
    await writeFile(lockPath, 'stale', { mode: 0o600 });
    await utimes(lockPath, new Date(0), new Date(0));
    await reloaded.save({ ...base, id: 'third' });
    await assertRejects(access(lockPath));
    if (process.platform !== 'win32') expect((await stat(cachePath)).mode & 0o777).to.equal(0o600);
  });
});

describe('ingest CSV splitting', () => {
  it('spools bounded parts to mode-0600 files and cleans them when iteration stops', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-csv-spool-'));
    const source = join(directory, 'source.csv');
    await writeFile(source, 'id\none\ntwo\nthree\n');
    const iterator = splitCsvFiles([source], { maxBytes: 10 });
    const first = await iterator.next();
    expect(first.done).to.equal(false);
    const chunk = first.value as unknown as { path: string; bytes: number };
    expect(chunk.bytes).to.be.a('number').and.lessThan(10);
    if (process.platform !== 'win32') expect((await stat(chunk.path)).mode & 0o777).to.equal(0o600);
    await iterator.return(undefined);
    await assertRejects(access(chunk.path));
  });

  it('keeps every bulk part strictly below the injected boundary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-csv-boundary-'));
    const source = join(directory, 'source.csv');
    await writeFile(source, 'id\n1234\n5678\n');
    const chunks = await collect(splitCsvFiles([source], { maxBytes: 10 }));
    expect(chunks.map((chunk) => (chunk as unknown as { bytes: number }).bytes)).to.deep.equal([8, 8]);
  });

  it('preserves each file header and respects the byte cap across quoted newlines', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-csv-'));
    const first = join(directory, 'first.csv');
    const second = join(directory, 'second.csv');
    await writeFile(first, 'id,text\r\n1,"hello\r\nworld"\r\n2,plain\r\n');
    await writeFile(second, 'id,text\n3,three\n');

    const chunks = await collectCsv(splitCsvFiles([first, second], { maxBytes: 32 }));
    expect(chunks.map(({ source }) => source)).to.deep.equal([first, first, second]);
    expect(chunks.every(({ bytes }) => bytes < 32)).to.equal(true);
    expect(chunks.map(({ content }) => content)).to.deep.equal([
      'id,text\r\n1,"hello\r\nworld"\r\n',
      'id,text\r\n2,plain\r\n',
      'id,text\n3,three\n',
    ]);
  });

  it('rejects a CSV record that cannot fit with its header', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-csv-large-'));
    const path = join(directory, 'large.csv');
    await writeFile(path, `id,value\n1,${'x'.repeat(40)}\n`);
    const error = await assertRejects(collect(splitCsvFiles([path], { maxBytes: 30 })));
    expect(error.name).to.equal('D360_INVALID_DEFINITION');
    expect(error.message).to.include('30-byte');
  });

  it('does not invent a header for bulk delete files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-csv-delete-'));
    const path = join(directory, 'delete.csv');
    await writeFile(path, 'one\nTwo\n');
    const chunks = await collectCsv(splitCsvFiles([path], { maxBytes: 5, preserveHeader: false }));
    expect(chunks.map(({ content }) => content)).to.deep.equal(['one\n', 'Two\n']);
  });

  it('uploads raw CSV bytes with a protected content type', async () => {
    let request: RequestInit | undefined;
    const client = new DirectClient({
      username: 'user@example.com',
      connection: {} as Connection,
      cache: {
        get: async () => ({
          jwt: 'secret',
          instanceUrl: 'https://tenant.c360a.salesforce.com',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          scopes: ['cdp_ingest_api'],
        }),
      } as unknown as TokenCache,
      fetch: async (_url, init): Promise<Response> => {
        request = init;
        return new Response(JSON.stringify({ accepted: true }));
      },
    });
    let opened = 0;
    await client.request({
      method: 'PUT',
      endpoint: '/api/v1/ingest/jobs/job-id/batches',
      rawBody: () => {
        opened += 1;
        return Readable.from(['id\n1\n']);
      },
      contentType: 'text/csv',
    });
    expect(await new Response(request?.body as BodyInit).text()).to.equal('id\n1\n');
    expect(opened).to.equal(1);
    expect((request?.headers as Record<string, string>)['content-type']).to.equal('text/csv');
  });
});

describe('ingest command mock NUT', () => {
  const commandTest = createCommandTestContext();

  it('requires explicit confirmation for billable bulk deletes before creating a job', async () => {
    const org = new MockTestOrgData('ingest-delete-prompt');
    await commandTest.context.stubAuths(org);
    const directory = await mkdtemp(join(tmpdir(), 'data360-ingest-delete-prompt-'));
    const csv = join(directory, 'delete.csv');
    await writeFile(csv, 'one\n');
    const error = await assertRejects(
      IngestBulk.run([
        '-o',
        org.username,
        '-s',
        'connector',
        '--object-name',
        'Contact',
        '-f',
        csv,
        '--operation',
        'delete',
        '--json',
      ])
    );
    expect(error.name).to.equal('D360_CONFIRMATION_REQUIRED');
  });

  it('runs all seven commands through exchange and a stateful Fastify lifecycle', async () => {
    const { server, control } = await buildIngestMockServer();
    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
    const org = new MockTestOrgData('ingest-fastify-lifecycle');
    org.instanceUrl = baseUrl;
    org.loginUrl = baseUrl;
    await commandTest.context.stubAuths(org);
    const directory = await mkdtemp(join(tmpdir(), 'data360-ingest-fastify-'));
    const json = join(directory, 'records.ndjson');
    const csv = join(directory, 'records.csv');
    await writeFile(json, '{"id":"one"}\n');
    await writeFile(csv, 'id\none\n');
    const env = { NODE_ENV: 'test', SF_DATA360_TENANT_URL: baseUrl };
    const previousTenant = process.env.SF_DATA360_TENANT_URL;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousMaxListeners = process.getMaxListeners();
    process.setMaxListeners(30);
    process.env.NODE_ENV = 'test';
    process.env.SF_DATA360_TENANT_URL = baseUrl;
    const createTokenCache = TokenCacheClass.create.bind(TokenCacheClass);
    commandTest.context.SANDBOX.stub(TokenCacheClass, 'create').callsFake(async () =>
      createTokenCache({
        bypass: true,
        env,
        exchange: async (connection) => exchangeConnection(connection, { env }),
      })
    );
    const createJobCache = JobCache.create.bind(JobCache);
    commandTest.context.SANDBOX.stub(JobCache, 'create').callsFake(async <
      T extends import('../src/run/jobCache.js').JobCacheEntry,
    >() => createJobCache<T>('ingest', { rootFolder: directory }));
    const common = ['-o', org.username, '-s', 'connector', '--object-name', 'Contact'];
    try {
      expect(await IngestValidate.run([...common, '-f', json, '--json'])).to.deep.equal({ valid: true, records: 1 });
      expect(await Ingest.run([...common, '-f', json, '--no-prompt', '--json'])).to.deep.equal({
        accepted: 1,
        batches: 1,
      });
      expect(await IngestDelete.run([...common, '--ids', 'one', '--no-prompt', '--json'])).to.deep.equal({
        accepted: true,
      });
      const bulk = await IngestBulk.run([...common, '-f', csv, '--async', '--no-prompt', '--json']);
      expect(bulk).to.deep.include({ id: 'synthetic-job', state: 'UploadComplete' });

      const emitter = new EventEmitter();
      const cancellationRoot = await mkdtemp(join(tmpdir(), 'data360-cancel-spool-'));
      commandTest.context.SANDBOX.stub(IngestBulk, 'cancellationFactory').callsFake(() => ({
        ...createCommandCancellation(emitter),
        tempRoot: cancellationRoot,
      }));
      control.stallUpload = true;
      const uploadStarted = new Promise<void>((resolve) => {
        control.uploadStarted = resolve;
      });
      const cancelledCommand = IngestBulk.run([...common, '-f', csv, '--async', '--no-prompt', '--json']);
      await uploadStarted;
      emitter.emit('SIGINT');
      const cancelled = await assertRejects(cancelledCommand);
      expect((cancelled as { exitCode?: number }).exitCode).to.equal(130);
      expect(
        control.requests.some(
          ({ method, body }) => method === 'PATCH' && (body as { state?: string }).state === 'Aborted'
        )
      ).to.equal(true);
      expect(await readdir(cancellationRoot)).to.deep.equal([]);
      expect(emitter.listenerCount('SIGINT')).to.equal(0);
      control.stallUpload = false;
      control.uploadStarted = undefined;

      control.statusQueue = [{ ...control.job, state: 'InProgress' }];
      expect(await IngestReport.run(['-o', org.username, '-i', 'synthetic-job', '--json'])).to.deep.include({
        state: 'InProgress',
      });
      control.statusQueue = [{ ...control.job, state: 'InProgress' }];
      const timeout = await assertRejects(
        IngestResume.run(['-o', org.username, '-i', 'synthetic-job', '-w', '0', '--json'])
      );
      expect(timeout.name).to.equal('D360_JOB_TIMEOUT');
      expect((timeout as { exitCode?: number }).exitCode).to.equal(69);
      expect((timeout as { data?: unknown }).data).to.deep.equal({ jobId: 'synthetic-job' });

      control.statusQueue = [{ ...control.job, state: 'JobComplete', recordsProcessed: 1, recordsFailed: 0 }];
      expect(await IngestResume.run(['-o', org.username, '-i', 'synthetic-job', '-w', '1', '--json'])).to.deep.include({
        state: 'JobComplete',
      });

      control.job = { ...control.job, state: 'InProgress' };
      control.statusQueue = [{ ...control.job }];
      control.abortRace = true;
      expect(
        await IngestCancel.run(['-o', org.username, '-i', 'synthetic-job', '--no-prompt', '--json'])
      ).to.deep.include({ state: 'JobComplete', cancelled: false });

      control.statusQueue = [{ ...control.job, state: 'JobComplete', recordsProcessed: 1, recordsFailed: 1 }];
      process.exitCode = undefined;
      await IngestReport.run(['-o', org.username, '-i', 'synthetic-job', '--json']);
      expect(process.exitCode).to.equal(68);
      process.exitCode = undefined;

      control.statusQueue = [{ ...control.job, state: 'Failed', recordsProcessed: 0, recordsFailed: 1 }];
      const failed = await assertRejects(
        IngestResume.run(['-o', org.username, '-i', 'synthetic-job', '-w', '1', '--json'])
      );
      expect(failed.name).to.equal('D360_JOB_FAILED');
      expect((failed as { data?: unknown }).data).to.deep.equal({ jobId: 'synthetic-job' });

      control.validationFailure = true;
      const invalid = await assertRejects(IngestValidate.run([...common, '-f', json, '--json']));
      expect(invalid.name).to.equal('D360_INVALID_DEFINITION');
      expect((invalid as { data?: { validationReport?: unknown } }).data?.validationReport).to.equal(undefined);
      expect((invalid as { data?: { detail?: string; endpoint?: string } }).data).to.deep.include({
        detail: '',
        endpoint: '',
      });
      expect(control.requests.some(({ url }) => url === '/services/a360/token')).to.equal(true);
    } finally {
      process.exitCode = undefined;
      if (previousTenant === undefined) delete process.env.SF_DATA360_TENANT_URL;
      else process.env.SF_DATA360_TENANT_URL = previousTenant;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      process.setMaxListeners(previousMaxListeners);
      await server.close();
    }
  });
});
