import { mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import { Flags } from '@oclif/core';
import * as configModule from '../src/configMeta.js';
import { normalizeApiError } from '../src/client/errors.js';
import { paginate } from '../src/client/pagination.js';
import * as requestModule from '../src/client/request.js';
import { withRetry } from '../src/client/retry.js';
import * as userAgentModule from '../src/client/userAgent.js';
import { Data360Command } from '../src/command/Data360Command.js';
import { defineResource } from '../src/resources/defineResource.js';
import { registry, ResourceRegistry } from '../src/resources/registry.js';
import * as sharedFlags from '../src/shared/flags.js';
import { readInput } from '../src/shared/input.js';
import { buildSsotPath } from '../src/shared/path.js';
import { assertRejects, collect } from './helpers/async.js';
import { createCommandTestContext } from './helpers/command.js';
import * as criteria from './helpers/commandCriteria.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as {
  version: string;
  oclif: { configMeta?: string };
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};
const { fileFlag, resultFormatFlag, targetOrgFlag } = sharedFlags;
const { request } = requestModule;

class TestData360Command extends Data360Command<unknown> {
  public async run(): Promise<unknown> {
    return Promise.resolve({});
  }

  public writeStatus(message: string): void {
    this.status(message);
  }

  public writeData(message: string): void {
    this.log(message);
  }

  public async initialize<P, C>(options: unknown): Promise<{ parsed: P; connection: C; requestTiming: unknown }> {
    const initializeTiming = (
      this as unknown as {
        initializeTiming: (value: unknown) => Promise<{ parsed: P; connection: C; requestTiming: unknown }>;
      }
    ).initializeTiming;
    return initializeTiming.call(this, options);
  }

  public async confirmForTest(noPrompt: boolean): Promise<void> {
    const confirmDestructive = (
      this as unknown as { confirmDestructive: (skip: boolean, message: string) => Promise<void> }
    ).confirmDestructive;
    return confirmDestructive.call(this, noPrompt, 'Continue?');
  }
}

describe('foundation', () => {
  it('roots relative SSOT paths and prevents escapes', () => {
    expect(buildSsotPath('67.0', 'segments')).to.equal('/services/data/v67.0/ssot/segments');
    expect(buildSsotPath('67.0', '/services/data/v67.0/ssot/segments')).to.equal('/services/data/v67.0/ssot/segments');
    expect(() => buildSsotPath('67.0', '../query')).to.throw('outside the ssot API root');
    expect(() => buildSsotPath('67.0', '/services/apexrest/private')).to.throw('outside the ssot API root');
  });

  it('retries GET but never POST', async () => {
    let gets = 0;
    const value = await withRetry(
      async () => {
        gets += 1;
        if (gets === 1) throw { statusCode: 503 };
        return 'ok';
      },
      { method: 'GET', delaysMs: [0] }
    );
    expect(value).to.equal('ok');
    expect(gets).to.equal(2);

    let posts = 0;
    await assertRejects(
      withRetry(
        async () => {
          posts += 1;
          throw { statusCode: 503 };
        },
        { method: 'POST', delaysMs: [0] }
      )
    );
    expect(posts).to.equal(1);
  });

  it('normalizes API errors into stable SfError codes', () => {
    const error = normalizeApiError({ statusCode: 429, body: { errorCode: 'LIMIT', message: 'Slow down' } });
    expect(error.name).to.equal('D360_RATE_LIMITED');
    expect(error.message).to.equal('The Data 360 API rate limit was reached.');
    expect(error.actions?.length).to.be.greaterThan(0);
    expect(error.data).to.deep.include({ httpStatus: 429, apiCode: 'LIMIT' });
    criteria.assertU9({
      isSfError: error.constructor.name === 'SfError',
      code: error.name,
      actions: error.actions ?? [],
      rawBodyReachable: Boolean(error.data),
    });
    const credentialError = normalizeApiError({
      statusCode: 400,
      body: { message: 'Invalid connection', password: 'super-secret', clientSecret: 'also-secret' },
    });
    expect(credentialError.data?.detail).to.equal('');
    expect(credentialError.data?.detail).not.to.include('super-secret');
    const bearerValue = ['opaque', 'message', 'token'].join('-');
    const sessionValue = ['A+opaque', 'session', 'value'].join('-');
    const embedded = normalizeApiError({
      statusCode: 400,
      body: {
        message: `authorization=${['Bearer', bearerValue].join(' ')}`,
        detail: `sid=${`${'00D'}000000000001!${sessionValue}`}`,
      },
    });
    expect(embedded.message).not.to.include(bearerValue);
    expect(embedded.data?.detail).not.to.include(sessionValue);

    const tenantMarker = 'SYNTHETIC_CUSTOMER_MARKER';
    const minimized = normalizeApiError(
      {
        statusCode: 400,
        body: {
          message: tenantMarker,
          contact: tenantMarker,
          nested: { arbitrary: tenantMarker },
        },
      },
      `https://tenant.example/resources/${tenantMarker}?filter=${tenantMarker}`
    );
    expect(JSON.stringify(minimized)).not.to.include(tenantMarker);
    expect(minimized.data).to.deep.include({ detail: '', endpoint: '' });
  });

  it('returns exit 69 when a mutating action times out with an unknown server outcome', () => {
    const timeout = normalizeApiError(
      Object.assign(new DOMException('Request was aborted due to timeout.', 'AbortError'), {
        endpoint: '/data-streams/example/actions/run',
      }),
      '/services/data/v67.0/ssot/data-streams/example/actions/run',
      {
        actionTimeout: {
          label: 'data stream run',
          recoveryCommand: 'Run sf data360 data-stream get --name <name> --target-org <alias> before retrying.',
        },
      }
    );

    expect(timeout.name).to.equal('D360_JOB_TIMEOUT');
    expect(timeout.exitCode).to.equal(69);
    expect(timeout.message).to.include('server-side outcome is unknown');
    expect(timeout.actions).to.deep.equal([
      'Do not retry until you check the resource status; the server may have accepted this billable or mutating action.',
      'Run sf data360 data-stream get --name <name> --target-org <alias> before retrying.',
    ]);
    expect(timeout.data).to.deep.include({ httpStatus: 0, outcomeUnknown: true });

    const immediateFailure = normalizeApiError(new TypeError('fetch failed'), undefined, {
      actionTimeout: {
        label: 'data stream run',
        recoveryCommand: 'Check the stream.',
      },
    });
    expect(immediateFailure.name).to.equal('D360_API_ERROR');
    expect(immediateFailure.exitCode).to.equal(1);
  });

  it('normalizes live-shaped jsforce not-found errors', () => {
    const message = 'No record exists or User might not have access to DMO with Developer name : missing__dlm';
    const itemNotFound = normalizeApiError(
      Object.assign(new Error(message), {
        name: 'ITEM_NOT_FOUND',
        errorCode: 'ITEM_NOT_FOUND',
        data: { errorCode: 'ITEM_NOT_FOUND', message },
      }),
      '/services/data/v67.0/ssot/data-model-objects/missing__dlm'
    );

    expect(itemNotFound.name).to.equal('D360_NOT_FOUND');
    expect(itemNotFound.data).to.deep.include({
      httpStatus: 0,
      apiCode: 'ITEM_NOT_FOUND',
      message: 'The requested Data 360 resource was not found.',
    });

    const notFound = normalizeApiError({
      message: 'The requested query ID is unknown',
      data: { errorCode: 'NOT_FOUND', message: 'The requested query ID is unknown' },
    });

    expect(notFound.name).to.equal('D360_NOT_FOUND');
    expect(notFound.data).to.deep.include({ httpStatus: 0, apiCode: 'NOT_FOUND' });

    const nestedStatus = normalizeApiError({
      message: 'The requested resource is unavailable',
      data: {
        statusCode: 404,
        errorCode: 'UNEXPECTED_ERROR',
        message: 'The requested resource is unavailable',
      },
    });

    expect(nestedStatus.name).to.equal('D360_NOT_FOUND');
    expect(nestedStatus.data).to.deep.include({ httpStatus: 404, apiCode: 'UNEXPECTED_ERROR' });
  });

  it('paginates cursors and rejects repeated cursors', async () => {
    const pages = new Map<string | undefined, { data: number[]; nextBatchId?: string }>([
      [undefined, { data: [1], nextBatchId: 'next' }],
      ['next', { data: [2] }],
    ]);
    const values = await collect(paginate(({ cursor }) => Promise.resolve(pages.get(cursor)!)));
    expect(values).to.deep.equal([1, 2]);

    const repeated = paginate(({ cursor }) => Promise.resolve({ data: [cursor ? 2 : 1], nextBatchId: 'same' }));
    await assertRejects(collect(repeated), 'repeated cursor');
  });

  it('paginates offsets until total size', async () => {
    const offsets: number[] = [];
    const values = await collect(
      paginate(
        ({ offset }) => {
          offsets.push(offset);
          return Promise.resolve({ data: offset === 0 ? [1, 2] : [3], totalSize: 3 });
        },
        { pageSize: 2 }
      )
    );
    expect(values).to.deep.equal([1, 2, 3]);
    expect(offsets).to.deep.equal([0, 2]);
  });

  it('treats an oversized page without continuation metadata as an unpaged collection', async () => {
    const offsets: number[] = [];
    const values = await collect(
      paginate(
        ({ offset }) => {
          offsets.push(offset);
          return Promise.resolve({ data: [1, 2, 3] });
        },
        { pageSize: 2 }
      )
    );
    expect(values).to.deep.equal([1, 2, 3]);
    expect(offsets).to.deep.equal([0]);
  });

  it('reads file and stdin inputs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-'));
    const path = join(directory, 'query.sql');
    await writeFile(path, 'select 1');
    expect(await readInput(path)).to.equal('select 1');
    expect(await readInput('-', Readable.from(['select ', '2']))).to.equal('select 2');
  });

  it('validates resource definitions and duplicate topics', () => {
    expect(() => defineResource({ topic: '', base: '/segments', nameFields: ['name'], columns: ['name'] })).to.throw(
      'topic'
    );
    const resource = defineResource({
      topic: 'segment',
      base: '/segments',
      nameFields: ['apiName'],
      columns: ['apiName'],
    });
    const registry = new ResourceRegistry([resource]);
    expect(registry.get('segment')).to.equal(resource);
    expect(() => registry.register(resource)).to.throw('already registered');
    expect(() =>
      defineResource({ topic: 'bad', base: '/../segments', nameFields: ['name'], columns: ['name'] })
    ).to.throw('base');
    expect(() => defineResource({ topic: 'bad', base: '/segments', nameFields: ['name'], columns: [] })).to.throw(
      'columns'
    );
    expect(Object.isFrozen(resource.nameFields)).to.equal(true);
    expect(Object.isFrozen(resource.columns)).to.equal(true);
  });

  it('constructs stdin-capable and globally compatible flags', () => {
    expect(fileFlag.type).to.equal('option');
    expect(fileFlag.parse).to.be.a('function');
    expect(resultFormatFlag.options).to.deep.equal(['human', 'csv', 'json']);
    expect(resultFormatFlag.exclusive).to.include('json');
    expect(targetOrgFlag.required).to.equal(true);
    expect(Flags.string({}).type).to.equal(fileFlag.type);
  });

  it('registers config metadata and resolves data spaces in contract order', async () => {
    expect(packageJson.oclif.configMeta).to.equal('./lib/configMeta');
    expect(configModule.default.map(({ key }) => key)).to.deep.equal(['data360-data-space', 'data360-credit-notices']);
    const resolveDataSpace = (
      configModule as unknown as {
        resolveDataSpace: (options: unknown) => Promise<string>;
      }
    ).resolveDataSpace;
    const config = {
      getLocal: (): Promise<string> => Promise.resolve('local'),
      getGlobal: (): Promise<string> => Promise.resolve('global'),
    };
    expect(await resolveDataSpace({ flagValue: 'flag', env: { SF_DATA360_DATA_SPACE: 'env' }, config })).to.equal(
      'flag'
    );
    expect(await resolveDataSpace({ env: { SF_DATA360_DATA_SPACE: 'env' }, config })).to.equal('env');
    expect(await resolveDataSpace({ env: {}, config })).to.equal('local');
    expect(await resolveDataSpace({ env: {}, config: { ...config, getLocal: async () => undefined } })).to.equal(
      'global'
    );
    expect(
      await resolveDataSpace({
        env: {},
        config: { getLocal: async () => undefined, getGlobal: async () => undefined },
      })
    ).to.equal('default');
  });

  it('provides the complete shared flag kit', () => {
    const flags = sharedFlags as unknown as Record<string, Record<string, unknown>>;
    expect(flags.waitFlag).to.include({ type: 'option', char: 'w' });
    expect(flags.asyncFlag).to.include({ type: 'boolean' });
    expect(flags.asyncFlag.exclusive).to.include('wait');
    expect(flags.jobIdFlag).to.include({ type: 'option', char: 'i' });
    expect(flags.queryIdFlag).to.include({ type: 'option', char: 'i' });
    expect(flags.useMostRecentFlag).to.include({ type: 'boolean', char: 'r' });
    expect(flags.nameFlag).to.include({ type: 'option', char: 'n' });
    expect(flags.outputFileFlag).to.include({ type: 'option' });
    expect(flags.noPromptFlag).to.include({ type: 'boolean' });
    expect(flags.allFlag).to.include({ type: 'boolean' });
    expect(flags.limitFlag).to.include({ type: 'option', default: 100 });
    expect(flags.dataSpaceFlag).to.include({ type: 'option' });
    expect(flags.apiVersionFlag).to.include({ type: 'option' });
    expect(flags.timingFlag).to.include({ type: 'boolean' });
    expect(flags.optionalTargetOrgFlag.required).not.to.equal(true);
  });

  it('aggregates and formats real timing phases', async () => {
    let timing: unknown;
    const moments = [10, 30];
    const transport = async <T>(): Promise<T> => Promise.resolve('ok' as T);
    await request<string>(transport, {
      method: 'GET',
      url: '/test',
      parseMs: 3,
      connectionMs: 7,
      now: () => moments.shift()!,
      onTiming: (value) => {
        timing = value;
      },
    } as Parameters<typeof request>[1]);
    expect(timing).to.deep.equal({ parseMs: 3, connectionMs: 7, requestMs: 20, totalMs: 30 });
    const formatTiming = (requestModule as unknown as { formatTiming?: (value: unknown) => string }).formatTiming;
    expect(formatTiming?.(timing)).to.equal('Timing: parse 3ms · connection 7ms · request 20ms · total 30ms');
  });

  it('honors Retry-After seconds and HTTP dates', async () => {
    const waits: number[] = [];
    let secondsAttempts = 0;
    await withRetry(
      async () => {
        secondsAttempts += 1;
        if (secondsAttempts === 1) throw { statusCode: 503, headers: { 'retry-after': '1' } };
        return 'ok';
      },
      {
        method: 'GET',
        delaysMs: [0],
        random: () => 0,
        sleep: async (milliseconds) => {
          waits.push(milliseconds);
        },
      }
    );
    expect(waits).to.deep.equal([1000]);

    let dateAttempts = 0;
    await withRetry(
      async () => {
        dateAttempts += 1;
        if (dateAttempts === 1) {
          throw { statusCode: 429, headers: { 'Retry-After': new Date(12_000).toUTCString() } };
        }
        return 'ok';
      },
      {
        method: 'HEAD',
        delaysMs: [0],
        random: () => 0,
        now: () => 10_000,
        sleep: async (milliseconds) => {
          waits.push(milliseconds);
        },
      }
    );
    expect(waits).to.deep.equal([1000, 2000]);
  });

  it('normalizes Salesforce arrays and stable error mappings', () => {
    const syntax = normalizeApiError({
      statusCode: 400,
      body: [{ errorCode: 'MALFORMED_QUERY', message: 'unexpected token' }],
      endpoint: '/query-sql',
    });
    expect(syntax.name).to.equal('D360_QUERY_SYNTAX');
    expect(syntax.message).to.equal('The Data 360 query is invalid.');

    expect(
      normalizeApiError({ statusCode: 403, body: { message: 'Data 360 unavailable' } }, '/ssot/metadata').name
    ).to.equal('D360_NOT_PROVISIONED');
    expect(normalizeApiError({ statusCode: 403, body: { message: 'Forbidden' } }, '/ssot/segments').name).to.equal(
      'D360_API_ERROR'
    );
    expect(normalizeApiError({ statusCode: 500, body: { message: 'boom' } }).name).to.equal('D360_API_ERROR');
    criteria.assertU10({
      401: normalizeApiError({ statusCode: 401, body: { message: 'expired' } }).name,
      403: normalizeApiError({ statusCode: 403, body: { message: 'unavailable' } }, '/ssot/metadata').name,
      404: normalizeApiError({ statusCode: 404, body: { message: 'missing' } }).name,
      429: normalizeApiError({ statusCode: 429, body: { message: 'slow' } }).name,
      500: normalizeApiError({ statusCode: 500, body: { message: 'boom' } }).name,
      direct403: 'D360_SCOPE_MISSING',
    });
  });

  it('initializes the registry inventory through the implemented phase', () => {
    expect(registry.list().map(({ topic }) => topic)).to.deep.equal([
      'query',
      'metadata',
      'connection',
      'connector',
      'dlo',
      'dmo',
      'mapping',
      'data-stream',
      'transform',
      'data-space',
      'identity-resolution',
      'calculated-insight',
      'segment',
      'activation',
      'activation-target',
      'search-index',
      'data-graph',
      'data-kit',
      'retriever',
      'docai-config',
      'semantic-model',
      'data-action',
      'data-action-target',
    ]);
  });

  it('derives user-agent versions and includes P1-ready package tooling', () => {
    const getUserAgent = (userAgentModule as unknown as { getUserAgent?: (version?: string) => string }).getUserAgent;
    expect(getUserAgent?.('1.2.3')).to.equal('sf-plugin-data360/1.2.3');
    expect(getUserAgent?.()).to.equal(`sf-plugin-data360/${packageJson.version}`);
    expect(packageJson.devDependencies).to.include.keys(
      '@salesforce/cli-plugins-testkit',
      '@salesforce/dev-scripts',
      '@salesforce/ts-sinon'
    );
    expect(packageJson.scripts.build).to.include('yarn compile');
    expect(packageJson.scripts.build).to.include('yarn schemas:generate');
    expect(packageJson.scripts['format:check']).to.be.a('string');
  });
});

describe('Data360Command', () => {
  const commandTest = createCommandTestContext();

  it('routes status and selected timing through stubbable stderr UX', async () => {
    const command = Object.create(TestData360Command.prototype) as TestData360Command;
    command.writeStatus('ready');
    command.writeData('row');
    expect(commandTest.ux.logToStderr.calledWithExactly('ready')).to.equal(true);
    criteria.assertU6(
      commandTest.ux.log.calledWithExactly('row'),
      commandTest.ux.logToStderr.calledWithExactly('ready')
    );

    let parseCalls = 0;
    let connectionCalls = 0;
    const moments = [0, 4, 4, 10];
    const initialized = await command.initialize<{ flags: { timing: boolean } }, { id: string }>({
      parse: async () => {
        parseCalls += 1;
        return { flags: { timing: true } };
      },
      connect: async () => {
        connectionCalls += 1;
        return { id: 'connection' };
      },
      timingSelected: (parsed: { flags: { timing: boolean } }) => parsed.flags.timing,
      now: () => moments.shift()!,
    });
    expect(parseCalls).to.equal(1);
    expect(connectionCalls).to.equal(1);
    expect(initialized.parsed).to.deep.equal({ flags: { timing: true } });
    expect(initialized.connection).to.deep.equal({ id: 'connection' });

    const requestMoments = [10, 20];
    await request<string>(async <T>() => Promise.resolve('ok' as T), {
      method: 'GET',
      url: '/test',
      ...(initialized.requestTiming as object),
      now: () => requestMoments.shift()!,
    } as Parameters<typeof request>[1]);
    expect(
      commandTest.ux.logToStderr.calledWithExactly('Timing: parse 4ms · connection 6ms · request 10ms · total 20ms')
    ).to.equal(true);
    criteria.assertU7('Timing: parse 4ms · connection 6ms · request 10ms · total 20ms');
  });

  it('enforces the exact destructive confirmation decision matrix', async () => {
    const command = Object.create(TestData360Command.prototype) as TestData360Command;
    const jsonEnabled = commandTest.context.SANDBOX.stub(command as never, 'jsonEnabled');
    const confirm = commandTest.context.SANDBOX.stub(command as never, 'confirm');
    const stdinTTY = process.stdin.isTTY;
    const stdoutTTY = process.stdout.isTTY;
    const setTTY = (stdin: boolean, stdout: boolean): void => {
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: stdin });
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: stdout });
    };
    try {
      jsonEnabled.returns(false);
      setTTY(false, false);
      await command.confirmForTest(true);
      expect(confirm.called).to.equal(false);
      expect((await assertRejects(command.confirmForTest(false))).name).to.equal('D360_CONFIRMATION_REQUIRED');

      jsonEnabled.returns(true);
      setTTY(true, true);
      expect((await assertRejects(command.confirmForTest(false))).name).to.equal('D360_CONFIRMATION_REQUIRED');

      jsonEnabled.returns(false);
      confirm.resolves(true);
      await command.confirmForTest(false);
      expect(confirm.calledOnceWith({ message: 'Continue?', defaultAnswer: false, ms: 10_000 })).to.equal(true);

      confirm.resetHistory();
      confirm.resolves(false);
      expect((await assertRejects(command.confirmForTest(false))).name).to.equal('D360_CONFIRMATION_REQUIRED');
      expect(confirm.calledOnce).to.equal(true);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: stdinTTY });
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: stdoutTTY });
    }
  });
});
