import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { expect } from 'chai';
import Query from '../src/commands/data360/query.js';
import QueryCancel from '../src/commands/data360/query/cancel.js';
import QueryResults from '../src/commands/data360/query/results.js';
import QueryResume from '../src/commands/data360/query/resume.js';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import { createDataSpaceConfigAccess, resolveCommandDataSpace, resolveDataSpace } from '../src/configMeta.js';
import { request as sendRequest } from '../src/client/request.js';
import { QueryJobCache } from '../src/run/queryJobCache.js';
import { runQueryJob } from '../src/run/jobRunner.js';
import { encodeQueryId, mapQueryStatus, QueryJobAdapter, type QueryTransport } from '../src/run/queryJobAdapter.js';
import { resolveQueryInput } from '../src/run/types.js';
import { toCsv } from '../src/ux/csv.js';
import { fetchQueryRows, iterateQueryPages, normalizeQueryPage } from '../src/ux/queryOutput.js';
import { humanResult, orderedRows, terminalSafeTable } from '../src/ux/queryResult.js';
import { writeQueryPages, writeQueryResult } from '../src/ux/resultWriter.js';
import { assertRejects } from './helpers/async.js';
import { createCommandTestContext } from './helpers/command.js';
import { loadFixture } from './helpers/fixtures.js';

const submitted = loadFixture<{
  status: { completionStatus: string; queryId: string };
}>('query/submit-results.json');
const submittedWithoutRows = loadFixture<{
  status: { completionStatus: string; queryId: string };
}>('query/submit-no-rows.json');
const finished = loadFixture<{
  completionStatus: string;
  queryId: string;
  rowCount: number;
}>('query/status-finished.json');

describe('query framework', () => {
  const commandTest = createCommandTestContext();

  it('uses the verified wire shape and maps statuses', async () => {
    const requests: Array<{ method: string; endpoint: string; body?: unknown }> = [];
    const transport: QueryTransport = {
      request: async <T>(request: { method: 'GET' | 'POST' | 'DELETE'; endpoint: string; body?: unknown }) => {
        requests.push(request);
        return submitted as T;
      },
    };
    const adapter = new QueryJobAdapter(transport, 'default', 'nightly-audit');
    const response = await adapter.submit('select 1 where value = :value', 10, {
      sqlParameters: [{ name: 'value', type: 'Integer', value: '1' }],
      querySettings: { query_timeout: '10000ms' },
    });
    expect(response.status.queryId).to.equal('opaque/id%value');
    expect(requests[0]).to.deep.equal({
      method: 'POST',
      endpoint: '/query-sql?dataspace=default&workloadName=nightly-audit',
      body: {
        sql: 'select 1 where value = :value',
        rowLimit: 10,
        sqlParameters: [{ name: 'value', type: 'Integer', value: '1' }],
        querySettings: { query_timeout: '10000ms' },
      },
    });
    await adapter.status('query/id');
    await adapter.rows('query/id', 2, 5, true);
    await adapter.cancel('query/id');
    expect(requests.slice(1).map(({ endpoint }) => endpoint)).to.deep.equal([
      '/query-sql/query%2Fid?dataspace=default&workloadName=nightly-audit',
      '/query-sql/query%2Fid/rows?dataspace=default&workloadName=nightly-audit&offset=2&rowLimit=5&omitSchema=true',
      '/query-sql/query%2Fid?dataspace=default&workloadName=nightly-audit',
    ]);
    expect(mapQueryStatus('ResultsProduced')).to.deep.include({ terminal: true, successful: true });
    expect(mapQueryStatus('Finished')).to.deep.include({ terminal: true, successful: true });
    expect(mapQueryStatus('Running')).to.deep.include({ terminal: false });
    expect(mapQueryStatus('Failed')).to.deep.include({ terminal: true, successful: false });
    expect(mapQueryStatus('Cancelled')).to.deep.include({ terminal: true, successful: false });
  });

  it('encodes opaque IDs once and builds status, rows, and cancel paths', async () => {
    const endpoints: string[] = [];
    const transport: QueryTransport = {
      request: async <T>({ endpoint }: { endpoint: string }) => {
        endpoints.push(endpoint);
        return {} as T;
      },
    };
    const adapter = new QueryJobAdapter(transport, 'space name');
    await adapter.status('opaque/id%25value');
    await adapter.rows('opaque/id%25value', 3, 5, true);
    await adapter.cancel('opaque/id%25value');
    expect(encodeQueryId('opaque/id%25value')).to.equal('opaque%2Fid%25value');
    expect(encodeQueryId('opaque/id')).to.equal('opaque%2Fid');
    expect(encodeQueryId('opaque%2Fid')).to.equal('opaque%2Fid');
    expect(endpoints).to.deep.equal([
      '/query-sql/opaque%2Fid%25value?dataspace=space%20name',
      '/query-sql/opaque%2Fid%25value/rows?dataspace=space%20name&offset=3&rowLimit=5&omitSchema=true',
      '/query-sql/opaque%2Fid%25value?dataspace=space%20name',
    ]);
  });

  it('persists latest entries and expires query jobs after three days', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-query-cache-'));
    let now = Date.parse('2026-07-01T00:00:00Z');
    const cache = await QueryJobCache.create({ rootFolder: directory, now: () => now });
    await cache.save({
      id: 'first',
      username: 'user@example.com',
      apiVersion: '67.0',
      dataSpace: 'default',
      submittedAt: new Date(now).toISOString(),
      output: { format: 'csv', file: 'rows.csv' },
    });
    now += 1000;
    await cache.save({
      id: 'second',
      username: 'user@example.com',
      apiVersion: '67.0',
      dataSpace: 'default',
      submittedAt: new Date(now).toISOString(),
    });
    expect((await cache.latest())?.id).to.equal('second');
    await cache.save({
      id: 'same-millisecond',
      username: 'user@example.com',
      apiVersion: '67.0',
      dataSpace: 'default',
      submittedAt: new Date(now).toISOString(),
    });
    expect((await cache.latest('user@example.com'))?.id).to.equal('same-millisecond');
    now += 1;
    await cache.save({
      id: 'other-org',
      username: 'other@example.com',
      apiVersion: '67.0',
      dataSpace: 'default',
      submittedAt: new Date(now).toISOString(),
    });
    expect((await cache.latest())?.id).to.equal('other-org');
    expect((await cache.latest('user@example.com'))?.id).to.equal('same-millisecond');
    now += 4 * 24 * 60 * 60 * 1000;
    expect(await cache.get('second')).to.equal(undefined);
  });

  it('throws the timeout and failure contracts', async () => {
    const timeout = await assertRejects(
      runQueryJob(
        {
          status: async () => ({
            completionStatus: 'Running',
            queryId: 'opaque/id',
          }),
        },
        'opaque/id',
        { timeoutMs: 0, pollIntervalMs: 0 }
      )
    );
    expect(timeout.name).to.equal('D360_JOB_TIMEOUT');
    expect((timeout as { exitCode?: number }).exitCode).to.equal(69);
    expect((timeout as { actions?: string[] }).actions).to.deep.equal([
      'Run sf data360 query resume -r to continue waiting.',
    ]);
    expect((timeout as { data?: unknown }).data).to.deep.equal({ jobId: 'opaque/id' });

    const failed = await assertRejects(
      runQueryJob(
        {
          status: async () => ({
            completionStatus: 'Failed',
            queryId: 'failed-id',
          }),
        },
        'failed-id',
        { timeoutMs: 100, pollIntervalMs: 0 }
      )
    );
    expect(failed.name).to.equal('D360_JOB_FAILED');
    expect((failed as { data?: unknown }).data).to.deep.equal({ jobId: 'failed-id' });
  });

  it('resolves exactly one runtime query input source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-query-input-'));
    const path = join(directory, 'query.sql');
    await writeFile(path, 'select from_file');
    expect(await resolveQueryInput({ query: 'select inline', stdin: Readable.from([]), stdinIsTTY: true })).to.equal(
      'select inline'
    );
    expect(await resolveQueryInput({ file: path, stdin: Readable.from([]), stdinIsTTY: true })).to.equal(
      'select from_file'
    );
    expect(await resolveQueryInput({ stdin: Readable.from(['select piped']), stdinIsTTY: false })).to.equal(
      'select piped'
    );
    expect(await resolveQueryInput({ file: '-', stdin: Readable.from(['select dash']), stdinIsTTY: false })).to.equal(
      'select dash'
    );
    await assertRejects(resolveQueryInput({ stdin: Readable.from([]), stdinIsTTY: true }), 'query source');
    await assertRejects(
      resolveQueryInput({ query: 'select 1', stdin: Readable.from(['select 2']), stdinIsTTY: false }),
      'exactly one'
    );
  });

  it('orders human rows by metadata and escapes RFC4180 CSV', () => {
    const response = {
      metadata: [
        { name: 'second', type: 'Varchar', nullable: true },
        { name: 'first', type: 'Varchar', nullable: true },
      ],
      data: [
        ['a,b', 'say "hello"'],
        ['line\nbreak', null],
      ],
      returnedRows: 2,
    };
    expect(orderedRows(response)).to.deep.equal([
      { second: 'a,b', first: 'say "hello"' },
      { second: 'line\nbreak', first: null },
    ]);
    expect(toCsv(response.metadata, response.data)).to.equal(
      'second,first\r\n"a,b","say ""hello"""\r\n"line\nbreak",\r\n'
    );
    const placed = {
      metadata: [
        { name: 'second', type: 'Varchar', placeInOrder: 2 },
        { name: 'first', type: 'Varchar', placeInOrder: 1 },
      ],
      data: [['b', 'a']],
      returnedRows: 1,
    };
    expect(orderedRows(placed)).to.deep.equal([{ first: 'a', second: 'b' }]);
    expect(humanResult(placed)).to.equal('first\tsecond\na\tb\n');
  });

  it('neutralizes spreadsheet formulas and terminal control sequences', () => {
    const metadata = [{ name: 'value', type: 'Varchar', nullable: true }];
    expect(toCsv(metadata, [['=cmd'], ['  +SUM(A1:A2)'], [-42]])).to.equal(
      "value\r\n'=cmd\r\n'  +SUM(A1:A2)\r\n-42\r\n"
    );
    expect(humanResult({ metadata, data: [['safe\u001B[2Jspoofed\nrow']], returnedRows: 1 })).to.equal(
      'value\nsafe\\x1b[2Jspoofed\\x0arow\n'
    );
    expect(
      terminalSafeTable({
        metadata: [{ name: 'column\u0007name', type: 'Varchar', nullable: true }],
        data: [['safe\u001B[2Jspoofed\rrow']],
        returnedRows: 1,
      })
    ).to.deep.equal({
      columns: ['column\\x07name'],
      data: [{ 'column\\x07name': 'safe\\x1b[2Jspoofed\\x0drow' }],
    });
  });

  it('writes query output atomically and preserves an existing file on stream failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-query-output-'));
    const output = join(directory, 'rows.json');
    const response = {
      metadata: [{ name: 'id', type: 'Varchar', nullable: false }],
      data: [['one']],
      returnedRows: 1,
    };
    await writeQueryResult(response, 'json', output);
    expect(JSON.parse(await readFile(output, 'utf8'))).to.deep.equal([['one']]);
    await writeFile(output, 'original');
    async function* failingPages(): AsyncGenerator<typeof response> {
      yield response;
      throw new Error('fixture failed');
    }
    await assertRejects(writeQueryPages(failingPages(), 'json', output), 'fixture failed');
    expect(await readFile(output, 'utf8')).to.equal('original');
    expect((await readdir(directory)).filter((entry) => entry.endsWith('.tmp'))).to.deep.equal([]);
  });

  it('paginates rows from an offset and drains all pages only with --all', async () => {
    const offsets: number[] = [];
    const adapter = {
      rows: async (
        _id: string,
        offset: number,
        rowLimit: number
      ): Promise<{
        data: number[][];
        metadata: Array<{ name: string; type: string }>;
        returnedRows: number;
      }> => {
        offsets.push(offset);
        const data = offset === 2 ? [[2], [3]] : [[4]];
        return { data: data.slice(0, rowLimit), metadata: [{ name: 'id', type: 'Number' }], returnedRows: data.length };
      },
    };
    const one = await fetchQueryRows(adapter, 'id', { offset: 2, rowLimit: 2, all: false });
    expect(one.data).to.deep.equal([[2], [3]]);
    const all = await fetchQueryRows(adapter, 'id', { offset: 2, rowLimit: 2, all: true });
    expect(all.data).to.deep.equal([[2], [3], [4]]);
    expect(offsets).to.deep.equal([2, 2, 4]);

    const pages: unknown[][][] = [];
    for await (const page of iterateQueryPages(adapter, 'id', { offset: 2, rowLimit: 2, all: true })) {
      pages.push(page.data);
    }
    expect(pages).to.deep.equal([[[2], [3]], [[4]]]);
  });

  it('streams 100k rows across 50 pages through a mid-drain GET 429 without reading ahead of backpressure', async () => {
    const pageCount = 50;
    const rowLimit = 2000;
    const requestedOffsets: number[] = [];
    let completedPageWrites = 0;
    let rateLimitAttempts = 0;
    const sink = new Writable({
      decodeStrings: false,
      highWaterMark: 1,
      write(_chunk, _encoding, callback): void {
        setImmediate(() => {
          completedPageWrites += 1;
          callback();
        });
      },
    });
    const adapter = {
      rows: async (
        _id: string,
        offset: number
      ): Promise<{
        data: Array<[number, string]>;
        metadata: Array<{ name: string; type: string }>;
        returnedRows: number;
      }> => {
        const pageIndex = offset / rowLimit;
        // A false-returning sink write must drain before the generator requests another page.
        expect(completedPageWrites).to.equal(Math.min(pageIndex, pageCount));
        requestedOffsets.push(offset);
        return sendRequest<{
          data: Array<[number, string]>;
          metadata: Array<{ name: string; type: string }>;
          returnedRows: number;
        }>(
          async <T>() => {
            if (pageIndex === 25) {
              rateLimitAttempts += 1;
              if (rateLimitAttempts === 1) {
                throw { statusCode: 429, headers: { 'retry-after': '0' }, body: { message: 'slow down' } };
              }
            }
            const data: Array<[number, string]> =
              pageIndex < pageCount
                ? Array.from({ length: rowLimit }, (_, index) => [offset + index, `value-${offset + index}`])
                : [];
            return {
              data,
              metadata: [
                { name: 'id', type: 'Number' },
                { name: 'value', type: 'Varchar' },
              ],
              returnedRows: data.length,
            } as T;
          },
          {
            method: 'GET',
            url: `/services/data/v67.0/ssot/query-sql/soak/rows?offset=${offset}&rowLimit=${rowLimit}`,
            parseMs: 0,
            connectionMs: 0,
          }
        );
      },
    };

    const rows = await writeQueryPages(
      iterateQueryPages(adapter, 'soak', { offset: 0, rowLimit, all: true }),
      'csv',
      undefined,
      sink
    );

    expect(rows).to.equal(100_000);
    expect(completedPageWrites).to.equal(pageCount);
    expect(requestedOffsets).to.deep.equal(Array.from({ length: pageCount + 1 }, (_, index) => index * rowLimit));
    expect(rateLimitAttempts).to.equal(2);
  });

  it('normalizes the zero-row wire shape when data and counts are omitted', async () => {
    const normalized = normalizeQueryPage({ metadata: [] } as never);
    expect(normalized).to.deep.equal({ data: [], metadata: [], returnedRows: 0 });
    const rows = await fetchQueryRows({ rows: async () => ({ metadata: [] }) as never }, 'zero-row-id', {
      offset: 0,
      rowLimit: 10,
      all: true,
    });
    expect(rows).to.deep.equal({ data: [], metadata: [], returnedRows: 0 });
    expect(normalizeQueryPage({ metadata: [], data: [['one']], returnedRows: 10 } as never).returnedRows).to.equal(1);
  });

  it('maps syntax errors and never retries a POST 429', async () => {
    let attempts = 0;
    const error = await assertRejects(
      sendRequest(
        async () => {
          attempts += 1;
          throw { statusCode: 429, body: { message: 'slow down' } };
        },
        { method: 'POST', url: '/services/data/v67.0/ssot/query-sql', parseMs: 0, connectionMs: 0 }
      )
    );
    expect(attempts).to.equal(1);
    expect(error.name).to.equal('D360_RATE_LIMITED');
    expect(
      (
        await assertRejects(
          sendRequest(
            async () => {
              throw { statusCode: 400, body: { errorCode: 'QUERY_SYNTAX', message: 'bad sql' } };
            },
            { method: 'POST', url: '/services/data/v67.0/ssot/query-sql', parseMs: 0, connectionMs: 0 }
          )
        )
      ).name
    ).to.equal('D360_QUERY_SYNTAX');
  });

  it('adapts command config to shared data-space precedence', async () => {
    const local = {
      getInfo: (): {
        key: string;
        location: 'Local';
        value: string;
        isLocal: true;
        isGlobal: false;
        isEnvVar: false;
      } => ({
        key: 'data360-data-space',
        location: 'Local',
        value: 'local-space',
        isLocal: true,
        isGlobal: false,
        isEnvVar: false,
      }),
    };
    expect(await resolveDataSpace({ config: createDataSpaceConfigAccess(local), env: {} })).to.equal('local-space');
    expect(
      await resolveCommandDataSpace({
        flagValue: 'flag-space',
        env: { SF_DATA360_DATA_SPACE: 'env-space' },
        aggregator: local,
      })
    ).to.equal('flag-space');
    expect(
      await resolveCommandDataSpace({
        env: { SF_DATA360_DATA_SPACE: 'env-space' },
        aggregator: local,
      })
    ).to.equal('env-space');
  });

  it('uses real oclif parsing for negative flag cases', async () => {
    const org = new MockTestOrgData('query-parser');
    await commandTest.context.stubAuths(org);
    const directory = await mkdtemp(join(tmpdir(), 'data360-query-parser-'));
    const path = join(directory, 'query.sql');
    await writeFile(path, 'select 1');
    const exclusive = await assertRejects(
      Query.run(['--target-org', org.username, '--query', 'select 1', '--file', path]),
      'cannot also be provided'
    );
    expect((exclusive as { oclif?: { exit?: number } }).oclif?.exit).to.equal(2);
    const jsonConflict = await assertRejects(
      Query.run(['--target-org', org.username, '--query', 'select 1', '--result-format', 'json', '--json']),
      'cannot also be provided'
    );
    expect((jsonConflict as { oclif?: { exit?: number } }).oclif?.exit).to.equal(2);
    expect(await readFile(path, 'utf8')).to.equal('select 1');
  });

  it('executes a mocked submit through the real command parser and lifecycle', async () => {
    const org = new MockTestOrgData('query-command');
    await commandTest.context.stubAuths(org);
    const requests: unknown[] = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      requests.push(request);
      return {
        ...submitted,
        status: { ...submitted.status, rowCount: 10 },
      } as never;
    };
    const save = commandTest.context.SANDBOX.stub().resolves();
    const createCache = commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      save,
    } as unknown as QueryJobCache);

    const directory = await mkdtemp(join(tmpdir(), 'query-options-command-'));
    const queryOptions = join(directory, 'options.json');
    await writeFile(
      queryOptions,
      JSON.stringify({
        sqlParameters: [{ name: 'value', type: 'Integer', value: '1' }],
        querySettings: { query_timeout: '10000ms' },
      })
    );

    const result = await Query.run([
      '--target-org',
      org.username,
      '--query',
      'select :value',
      '--query-options-file',
      queryOptions,
      '--workload-name',
      'package-audit',
      '--no-prompt',
      '--json',
    ]);
    expect(result).to.deep.include({
      queryId: 'opaque/id%value',
      status: 'ResultsProduced',
      done: true,
      rowCount: 10,
    });
    expect(result.rows).to.have.length(1);
    const submitRequest = requests.find((request) => (request as { method?: string }).method === 'POST') as {
      method: string;
      body: string;
      url: string;
    };
    expect(submitRequest).to.deep.include({
      method: 'POST',
      body: JSON.stringify({
        sql: 'select :value',
        rowLimit: 5000,
        sqlParameters: [{ name: 'value', type: 'Integer', value: '1' }],
        querySettings: { query_timeout: '10000ms' },
      }),
    });
    expect(submitRequest.url).to.match(
      /\/services\/data\/v\d+\.\d+\/ssot\/query-sql\?dataspace=default&workloadName=package-audit$/u
    );
    expect(createCache.notCalled).to.equal(true);
    expect(save.notCalled).to.equal(true);
  });

  it('uses sf command table UX for human rows', async () => {
    const org = new MockTestOrgData('query-human-table');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> =>
      ((request as { method?: string }).method === 'POST' ? submitted : []) as never;
    commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      save: commandTest.context.SANDBOX.stub().resolves(),
    } as unknown as QueryJobCache);

    await Query.run(['--target-org', org.username, '--query', 'select 1', '--no-prompt']);
    expect(commandTest.ux.table.calledOnce).to.equal(true);
    expect(commandTest.ux.table.firstCall.args[0].columns).to.deep.equal(['ssot__Id__c']);
  });

  it('returns the final Finished status after polling and fetches rows', async () => {
    const org = new MockTestOrgData('query-polling');
    await commandTest.context.stubAuths(org);
    const requests: Array<{ method?: string; url?: string }> = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string };
      requests.push(value);
      if (value.method === 'POST') {
        return {
          status: { completionStatus: 'Running', queryId: 'polling-id', progress: 0 },
        } as never;
      }
      if (value.url?.includes('/rows?')) {
        return {
          data: [['row']],
          metadata: [{ name: 'value', type: 'Varchar', placeInOrder: 0 }],
          returnedRows: 1,
        } as never;
      }
      return finished as never;
    };
    commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      save: commandTest.context.SANDBOX.stub().resolves(),
    } as unknown as QueryJobCache);

    const result = await Query.run(['--target-org', org.username, '--query', 'select 1', '--no-prompt', '--json']);
    expect(result).to.deep.include({ queryId: 'polling-id', status: 'Finished', done: true, rowCount: 1 });
    expect(requests.some(({ url }) => url?.includes('/rows?'))).to.equal(true);
  });

  it('fetches terminal --async rows immediately without caching or printing invalid continuation hints', async () => {
    const org = new MockTestOrgData('query-terminal-no-rows');
    await commandTest.context.stubAuths(org);
    const requests: Array<{ method?: string; url?: string }> = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string };
      requests.push(value);
      return (
        value.method === 'POST'
          ? submittedWithoutRows
          : { data: [['fetched']], metadata: [{ name: 'value', type: 'Varchar' }], returnedRows: 1 }
      ) as never;
    };
    const save = commandTest.context.SANDBOX.stub().resolves();
    const createCache = commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      save,
    } as unknown as QueryJobCache);

    const result = await Query.run([
      '--target-org',
      org.username,
      '--query',
      'select 1',
      '--async',
      '--no-prompt',
      '--json',
    ]);
    expect(result.rows).to.deep.equal([['fetched']]);
    expect(requests.some(({ url }) => url?.includes('/rows?'))).to.equal(true);
    expect(createCache.notCalled).to.equal(true);
    expect(save.notCalled).to.equal(true);
    expect(commandTest.ux.logToStderr.calledWith('sf data360 query resume -r')).to.equal(false);
  });

  it('returns inline terminal --async rows without a status or rows request', async () => {
    const org = new MockTestOrgData('query-terminal-inline-async');
    await commandTest.context.stubAuths(org);
    const requests: Array<{ method?: string; url?: string }> = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      requests.push(request as { method?: string; url?: string });
      return submitted as never;
    };
    const createCache = commandTest.context.SANDBOX.stub(QueryJobCache, 'create');

    const result = await Query.run([
      '--target-org',
      org.username,
      '--query',
      'select 1',
      '--async',
      '--no-prompt',
      '--json',
    ]);

    expect(result).to.deep.include({
      queryId: submitted.status.queryId,
      status: 'ResultsProduced',
      done: true,
    });
    expect(result.rows).to.deep.equal([['001000000000001']]);
    expect(requests.filter(({ url }) => url?.includes('/ssot/query-sql')).map(({ method }) => method)).to.deep.equal([
      'POST',
    ]);
    expect(createCache.notCalled).to.equal(true);
    expect(commandTest.ux.logToStderr.calledWith('sf data360 query resume -r')).to.equal(false);
  });

  it('normalizes a successful zero-row response that omits data', async () => {
    const org = new MockTestOrgData('query-terminal-zero-row');
    await commandTest.context.stubAuths(org);
    const requests: Array<{ method?: string; url?: string }> = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string };
      requests.push(value);
      if (value.method === 'POST') {
        return {
          status: { completionStatus: 'ResultsProduced', queryId: 'zero-row-id', rowCount: 0 },
        } as never;
      }
      return { metadata: [], returnedRows: 0 } as never;
    };
    const createCache = commandTest.context.SANDBOX.stub(QueryJobCache, 'create');

    const result = await Query.run([
      '--target-org',
      org.username,
      '--query',
      'select 1 where 1 = 0',
      '--workload-name',
      'zero-row-audit',
      '--no-prompt',
      '--json',
    ]);

    expect(result).to.deep.include({
      queryId: 'zero-row-id',
      status: 'ResultsProduced',
      done: true,
      rowCount: 0,
      columns: [],
      rows: [],
    });
    const queryRequests = requests.filter(({ url }) => url?.includes('/ssot/query-sql'));
    expect(queryRequests.some(({ url }) => url?.includes('/rows?'))).to.equal(true);
    expect(queryRequests.every(({ url }) => url?.includes('workloadName=zero-row-audit'))).to.equal(true);
    expect(createCache.notCalled).to.equal(true);
  });

  it('prints exact async hints only in human mode', async () => {
    const org = new MockTestOrgData('query-async');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> =>
      ((request as { method?: string }).method === 'POST'
        ? { status: { completionStatus: 'Running', queryId: 'async/id' } }
        : []) as never;
    commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      save: commandTest.context.SANDBOX.stub().resolves(),
    } as unknown as QueryJobCache);

    await Query.run(['--target-org', org.username, '--query', 'select 1', '--async', '--no-prompt']);
    expect(commandTest.ux.logToStderr.calledWithExactly('sf data360 query resume -r')).to.equal(true);
    expect(commandTest.ux.logToStderr.calledWithExactly('sf data360 query results -i "async/id"')).to.equal(true);
  });

  it('suppresses async hints under global JSON', async () => {
    const org = new MockTestOrgData('query-async-json');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> =>
      ((request as { method?: string }).method === 'POST'
        ? { status: { completionStatus: 'Running', queryId: 'async-json-id' } }
        : []) as never;
    commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      save: commandTest.context.SANDBOX.stub().resolves(),
    } as unknown as QueryJobCache);

    await Query.run(['--target-org', org.username, '--query', 'select 1', '--async', '--no-prompt', '--json']);
    expect(commandTest.ux.logToStderr.calledWith('sf data360 query resume -r')).to.equal(false);
    expect(commandTest.ux.logToStderr.calledWith('sf data360 query results -i "async-json-id"')).to.equal(false);
  });

  it('honors an output file with the global JSON envelope', async () => {
    const org = new MockTestOrgData('query-json-file');
    await commandTest.context.stubAuths(org);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> =>
      ((request as { method?: string }).method === 'POST' ? submitted : []) as never;
    commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      save: commandTest.context.SANDBOX.stub().resolves(),
    } as unknown as QueryJobCache);
    const directory = await mkdtemp(join(tmpdir(), 'data360-query-output-'));
    const output = join(directory, 'rows.txt');

    const result = await Query.run([
      '--target-org',
      org.username,
      '--query',
      'select 1',
      '--no-prompt',
      '--json',
      '--output-file',
      output,
    ]);
    expect(result.rows).to.have.length(1);
    expect(await readFile(output, 'utf8')).to.contain('ssot__Id__c');
  });

  it('rejects async with wait before making an HTTP request', async () => {
    const org = new MockTestOrgData('query-invalid-async');
    await commandTest.context.stubAuths(org);
    const requests: unknown[] = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      requests.push(request);
      return {} as never;
    };
    const error = await assertRejects(
      Query.run(['--target-org', org.username, '--query', 'select 1', '--async', '--wait', '1']),
      'cannot also be provided'
    );
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).to.equal(2);
    expect(requests.filter((request) => (request as { url?: string }).url?.includes('/ssot/'))).to.deep.equal([]);
  });

  it('enforces resume identifier parser constraints before Data 360 requests', async () => {
    const org = new MockTestOrgData('query-resume-parser');
    await commandTest.context.stubAuths(org);
    const requests: unknown[] = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      requests.push(request);
      return {} as never;
    };
    const missing = await assertRejects(QueryResume.run(['--target-org', org.username]), 'Exactly one');
    expect((missing as { oclif?: { exit?: number } }).oclif?.exit).to.equal(2);
    const both = await assertRejects(
      QueryResume.run(['--target-org', org.username, '--query-id', 'one', '--use-most-recent']),
      'cannot also be provided'
    );
    expect((both as { oclif?: { exit?: number } }).oclif?.exit).to.equal(2);
    expect(requests.filter((request) => (request as { url?: string }).url?.includes('/ssot/'))).to.deep.equal([]);
  });

  it('uses cached resume output defaults and lets explicit flags win', async () => {
    const org = new MockTestOrgData('query-resume-output');
    await commandTest.context.stubAuths(org);
    const directory = await mkdtemp(join(tmpdir(), 'data360-resume-output-'));
    const cachedFile = join(directory, 'cached.csv');
    const explicitFile = join(directory, 'explicit.json');
    const entry = {
      id: 'resume-id',
      username: org.username,
      apiVersion: '42.0',
      dataSpace: 'default',
      submittedAt: new Date().toISOString(),
      output: { format: 'csv' as const, file: cachedFile },
    };
    commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      get: commandTest.context.SANDBOX.stub().resolves(entry),
    } as unknown as QueryJobCache);
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> =>
      ((request as { url?: string }).url?.includes('/rows?')
        ? { data: [['value']], metadata: [{ name: 'column', type: 'Varchar' }], returnedRows: 1 }
        : { completionStatus: 'Finished', queryId: 'resume-id', rowCount: 10 }) as never;

    const resumed = await QueryResume.run(['--target-org', org.username, '--query-id', 'resume-id']);
    expect(resumed.rowCount).to.equal(10);
    expect(resumed.rows).to.have.length(1);
    expect(await readFile(cachedFile, 'utf8')).to.equal('column\r\nvalue\r\n');

    await QueryResume.run([
      '--target-org',
      org.username,
      '--query-id',
      'resume-id',
      '--result-format',
      'json',
      '--output-file',
      explicitFile,
    ]);
    expect(await readFile(explicitFile, 'utf8')).to.equal('[\n  [\n    "value"\n  ]\n]\n');
  });

  it('resumes from retained rows when a completed live query status is already gone', async () => {
    const org = new MockTestOrgData('query-resume-retained');
    await commandTest.context.stubAuths(org);
    const queryId = 'retained/id';
    commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      get: commandTest.context.SANDBOX.stub().resolves({
        id: queryId,
        username: org.username,
        apiVersion: '67.0',
        dataSpace: 'default',
        workloadName: 'retained-audit',
        submittedAt: new Date().toISOString(),
      }),
    } as unknown as QueryJobCache);
    const requests: Array<{ method?: string; url?: string }> = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const value = request as { method?: string; url?: string };
      requests.push(value);
      if (value.url?.includes('/rows?')) {
        return {
          data: [['retained']],
          metadata: [{ name: 'value', type: 'Varchar' }],
          returnedRows: 1,
        } as never;
      }
      throw Object.assign(new Error('The requested query ID is unknown'), {
        statusCode: 404,
        body: { errorCode: 'NOT_FOUND', message: 'The requested query ID is unknown' },
      });
    };
    const submit = commandTest.context.SANDBOX.stub(QueryJobAdapter.prototype, 'submit');

    const resumed = await QueryResume.run(['--target-org', org.username, '--query-id', queryId, '--json']);
    expect(resumed).to.deep.include({
      queryId,
      status: 'ResultsProduced',
      done: true,
      rowCount: 1,
    });
    expect(resumed.rows).to.deep.equal([['retained']]);
    expect(submit.notCalled).to.equal(true);
    const queryRequests = requests.filter(({ url }) => url?.includes('/ssot/query-sql'));
    expect(queryRequests.map(({ method }) => method)).to.deep.equal(['GET', 'GET']);
    expect(queryRequests.every(({ url }) => url?.includes('retained%2Fid'))).to.equal(true);
    expect(queryRequests.every(({ url }) => url?.includes('workloadName=retained-audit'))).to.equal(true);
  });

  it('preserves the original status error when retained rows are also unavailable', async () => {
    const org = new MockTestOrgData('query-resume-original-error');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      get: commandTest.context.SANDBOX.stub().resolves({
        id: 'expired-id',
        username: org.username,
        apiVersion: '67.0',
        dataSpace: 'default',
        submittedAt: new Date().toISOString(),
      }),
    } as unknown as QueryJobCache);
    const statusError = Object.assign(new Error('status is gone'), {
      name: 'D360_NOT_FOUND',
      data: { httpStatus: 404, apiCode: 'NOT_FOUND', endpoint: '/query-sql/expired-id' },
      actions: ['Confirm the resource name or ID and try again.'],
    });
    commandTest.context.SANDBOX.stub(QueryJobAdapter.prototype, 'status').rejects(statusError);
    const rows = commandTest.context.SANDBOX.stub(QueryJobAdapter.prototype, 'rows').rejects(
      Object.assign(new Error('rows are gone'), { name: 'D360_NOT_FOUND' })
    );

    const caught = await assertRejects(
      QueryResume.run(['--target-org', org.username, '--query-id', 'expired-id', '--json'])
    );
    expect((caught as { cause?: unknown }).cause).to.equal(statusError);
    expect(caught.name).to.equal('D360_NOT_FOUND');
    expect(rows.calledOnce).to.equal(true);
    expect((caught as { data?: unknown }).data).to.deep.equal(statusError.data);
  });

  it('does not use rows fallback for non-not-found status errors', async () => {
    const org = new MockTestOrgData('query-resume-other-error');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      get: commandTest.context.SANDBOX.stub().resolves({
        id: 'other-error-id',
        username: org.username,
        apiVersion: '67.0',
        dataSpace: 'default',
        submittedAt: new Date().toISOString(),
      }),
    } as unknown as QueryJobCache);
    const statusError = Object.assign(new Error('NOT_FOUND appears only in text'), { name: 'D360_API_ERROR' });
    commandTest.context.SANDBOX.stub(QueryJobAdapter.prototype, 'status').rejects(statusError);
    const rows = commandTest.context.SANDBOX.stub(QueryJobAdapter.prototype, 'rows');

    const caught = await assertRejects(
      QueryResume.run(['--target-org', org.username, '--query-id', 'other-error-id', '--json'])
    );
    expect((caught as { cause?: unknown }).cause).to.equal(statusError);
    expect(caught.name).to.equal('D360_API_ERROR');
    expect(rows.notCalled).to.equal(true);
  });

  it('executes results pagination and omitSchema through the real parser', async () => {
    const org = new MockTestOrgData('query-results-command');
    await commandTest.context.stubAuths(org);
    const entry = {
      id: 'results-id',
      username: org.username,
      apiVersion: '42.0',
      dataSpace: 'default',
      submittedAt: new Date().toISOString(),
    };
    commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      get: commandTest.context.SANDBOX.stub().resolves(entry),
    } as unknown as QueryJobCache);
    const urls: string[] = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      const url = (request as { url?: string }).url ?? '';
      urls.push(url);
      if (!url.includes('/rows?')) {
        return { completionStatus: 'Finished', queryId: 'results-id', rowCount: 2 } as never;
      }
      const offset = Number(new URL(url, 'https://example.test').searchParams.get('offset'));
      return {
        data: offset < 2 ? [[offset]] : [],
        returnedRows: offset < 2 ? 1 : 0,
      } as never;
    };

    const result = await QueryResults.run([
      '--target-org',
      org.username,
      '--query-id',
      'results-id',
      '--row-limit',
      '1',
      '--all',
      '--omit-schema',
      '--json',
    ]);
    expect(result.rows).to.deep.equal([[0], [1]]);
    const rowUrls = urls.filter((url) => url.includes('/rows?'));
    expect(rowUrls).to.have.length(3);
    expect(rowUrls.every((url) => url.includes('omitSchema=true'))).to.equal(true);

    const directory = await mkdtemp(join(tmpdir(), 'data360-results-stream-'));
    const output = join(directory, 'all.json');
    await QueryResults.run([
      '--target-org',
      org.username,
      '--query-id',
      'results-id',
      '--row-limit',
      '1',
      '--all',
      '--omit-schema',
      '--result-format',
      'json',
      '--output-file',
      output,
    ]);
    expect(await readFile(output, 'utf8')).to.equal('[\n  [0],\n  [1]\n]\n');
  });

  it('rejects omitSchema for human and CSV before requesting query data', async () => {
    const org = new MockTestOrgData('query-omit-schema-invalid');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      get: commandTest.context.SANDBOX.stub().resolves({
        id: 'omit-id',
        username: org.username,
        apiVersion: '42.0',
        dataSpace: 'default',
        submittedAt: new Date().toISOString(),
      }),
    } as unknown as QueryJobCache);
    const requests: unknown[] = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      requests.push(request);
      return {} as never;
    };

    for (const format of ['human', 'csv']) {
      const error = await assertRejects(
        QueryResults.run([
          '--target-org',
          org.username,
          '--query-id',
          'omit-id',
          '--omit-schema',
          '--result-format',
          format,
        ])
      );
      expect(error.name).to.equal('D360_API_ERROR');
      expect((error as { actions?: string[] }).actions).to.include(
        'Use --result-format json or the global --json flag with --omit-schema.'
      );
    }
    expect(requests.filter((request) => (request as { url?: string }).url?.includes('/ssot/query-sql/'))).to.deep.equal(
      []
    );
  });

  it('fetches retained rows without requiring the status endpoint', async () => {
    const org = new MockTestOrgData('query-results-total');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      get: commandTest.context.SANDBOX.stub().resolves({
        id: 'total-id',
        username: org.username,
        apiVersion: '42.0',
        dataSpace: 'default',
        submittedAt: new Date().toISOString(),
      }),
    } as unknown as QueryJobCache);
    const requests: string[] = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      requests.push((request as { url?: string }).url ?? '');
      return {
        data: [[1], [2]],
        metadata: [{ name: 'id', type: 'Number' }],
        returnedRows: 2,
      } as never;
    };

    const result = await QueryResults.run([
      '--target-org',
      org.username,
      '--query-id',
      'total-id',
      '--row-limit',
      '2',
      '--json',
    ]);
    expect(result).to.deep.include({ status: 'ResultsProduced', done: true, rowCount: 2 });
    expect(result.rows).to.have.length(2);
    const queryRequests = requests.filter((url) => url.includes('/ssot/query-sql/'));
    expect(queryRequests).to.have.length(1);
    expect(queryRequests[0]).to.include('/rows?');
  });

  it('executes explicitly confirmed cancel through the real parser', async () => {
    const org = new MockTestOrgData('query-cancel-command');
    await commandTest.context.stubAuths(org);
    commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      get: commandTest.context.SANDBOX.stub().resolves(undefined),
    } as unknown as QueryJobCache);
    const requests: Array<{ method?: string; url?: string }> = [];
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      requests.push(request as { method?: string; url?: string });
      return {} as never;
    };

    const result = await QueryCancel.run([
      '--target-org',
      org.username,
      '--query-id',
      'cancel/id',
      '--data-space',
      'alternate',
      '--no-prompt',
      '--json',
    ]);
    expect(result).to.deep.equal({ queryId: 'cancel/id', cancelled: true });
    expect(
      requests.some(
        ({ method, url }) => method === 'DELETE' && url?.includes('cancel%2Fid') && url.includes('dataspace=alternate')
      )
    ).to.equal(true);
  });

  it('maps a failed resume status with job data', async () => {
    const org = new MockTestOrgData('query-resume-failed');
    await commandTest.context.stubAuths(org);
    const entry = {
      id: 'failed-resume',
      username: org.username,
      apiVersion: '42.0',
      dataSpace: 'default',
      submittedAt: new Date().toISOString(),
    };
    commandTest.context.SANDBOX.stub(QueryJobCache, 'create').resolves({
      get: commandTest.context.SANDBOX.stub().resolves(entry),
    } as unknown as QueryJobCache);
    commandTest.context.fakeConnectionRequest = async (): Promise<never> =>
      ({ completionStatus: 'Failed', queryId: 'failed-resume' }) as never;

    const error = await assertRejects(
      QueryResume.run(['--target-org', org.username, '--query-id', 'failed-resume', '--json'])
    );
    expect(error.name).to.equal('D360_JOB_FAILED');
    expect((error as { data?: unknown }).data).to.deep.equal({ jobId: 'failed-resume' });
  });
});
