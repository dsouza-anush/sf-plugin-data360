import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { fixturePayload } from '../helpers/fixtures.js';
import { appendTraceEvent, tracePayload } from '../../src/client/trace.js';

type RouteFixture = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  status: number;
  file: string;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export const buildMockServer = async (): Promise<FastifyInstance> => {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8')) as RouteFixture[];
  const server = Fastify({ logger: false });
  const rateLimits = new Map<string, number>();
  const mirrored = new Map<string, { commandReference: number; requestReference: number; startedAt: number }>();
  const latestCommandReference = async (): Promise<number> => {
    const path = process.env.SF_DATA360_TRACE;
    if (!path) return 0;
    try {
      const events = (await readFile(path, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { seq?: number; seqRef?: number; sid?: string; type?: string });
      for (const event of events.reverse()) {
        if (event.sid !== process.env.SF_DATA360_TRACE_ID) continue;
        if (typeof event.seqRef === 'number') return event.seqRef;
        if (event.type === 'command.exec' && typeof event.seq === 'number') return event.seq;
      }
    } catch {
      // No trace exists yet; the caller will fall back to command sequence 0.
    }
    return 0;
  };
  server.addHook('preHandler', async (request) => {
    if (!process.env.SF_DATA360_TRACE || request.headers['x-client-trace-id'] !== process.env.SF_DATA360_TRACE_ID)
      return;
    const commandReference = await latestCommandReference();
    const payload = tracePayload(request.body);
    const requestReference = await appendTraceEvent({
      type: 'http.request',
      seqRef: commandReference,
      method: request.method,
      url: request.url,
      root: 'mock',
      headers: Object.fromEntries(
        ['content-type', 'user-agent', 'x-client-trace-id']
          .filter((name) => request.headers[name] !== undefined)
          .map((name) => [name, request.headers[name]])
      ),
      bodyDigest: payload.digest,
      bodyBytes: payload.bytes,
      retryAttempt: 0,
    });
    if (requestReference !== undefined)
      mirrored.set(request.id, { commandReference, requestReference, startedAt: performance.now() });
  });
  server.addHook('onSend', async (request, reply, body) => {
    const entry = mirrored.get(request.id);
    if (!entry) return body;
    mirrored.delete(request.id);
    const payload = tracePayload(
      body && typeof (body as NodeJS.ReadableStream).pipe === 'function' ? '<omitted:stream-body>' : body
    );
    await appendTraceEvent({
      type: 'http.response',
      seqRef: entry.commandReference,
      requestRef: entry.requestReference,
      root: 'mock',
      status: reply.statusCode,
      statusInferred: false,
      durationMs: Math.max(0, performance.now() - entry.startedAt),
      retryAttempt: 0,
      headers: {},
      bodyDigest: payload.digest,
      bodyBytes: payload.bytes,
    });
    return body;
  });
  server.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) =>
    done(null, body)
  );
  server.addContentTypeParser('text/csv', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  for (const fixture of manifest) {
    server.route({
      method: fixture.method,
      url: fixture.path,
      handler: async (request, reply) => {
        const query = request.query as { __mock429?: string; __mockDelay?: string };
        if (query.__mockDelay) await new Promise((done) => setTimeout(done, Number(query.__mockDelay)));
        if (query.__mock429 === '1') {
          return reply
            .header('retry-after', '0')
            .code(429)
            .send([{ errorCode: 'REQUEST_LIMIT_EXCEEDED', message: 'Injected rate limit.' }]);
        }
        if (fixture.path === '/services/data/v67.0/ssot/query-sql') {
          const sql = String((request.body as { sql?: unknown } | undefined)?.sql ?? '');
          if (/\bSELEKT\b/iu.test(sql)) {
            return reply
              .code(400)
              .send([{ errorCode: 'MALFORMED_QUERY', message: 'Injected Data 360 SQL syntax error.' }]);
          }
          if (sql.includes('testbed:running')) {
            const status = fixturePayload(
              JSON.parse(await readFile(resolve(root, 'query/status-running.json'), 'utf8')) as {
                __fixture?: unknown;
                synthetic?: boolean;
              }
            );
            return reply.code(201).send({ status });
          }
        }
        const queryId = String((request.params as { queryId?: unknown } | undefined)?.queryId ?? '');
        if (queryId === 'testbed-429') {
          const key = `${fixture.method}:${fixture.path}:${queryId}`;
          const count = rateLimits.get(key) ?? 0;
          if (count < 2) {
            rateLimits.set(key, count + 1);
            return reply
              .header('retry-after', '0')
              .code(429)
              .send([{ errorCode: 'REQUEST_LIMIT_EXCEEDED', message: 'Injected rate limit.' }]);
          }
        }
        if (fixture.path === '/api/v1/ingest/sources/:source/:object/actions/test') {
          const records = (request.body as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? [];
          if (!records.some((record) => record.invalid === true)) {
            return reply.code(200).send({ valid: true });
          }
        }
        if (fixture.file === 'ingest/lifecycle.json') {
          const lifecycle = fixturePayload(
            JSON.parse(await readFile(resolve(root, fixture.file), 'utf8')) as {
              __fixture?: unknown;
              synthetic?: boolean;
            }
          ) as Record<string, unknown>;
          if (fixture.path === '/api/v1/ingest/jobs') return reply.code(fixture.status).send(lifecycle.create);
          if (fixture.method === 'PUT') return reply.code(fixture.status).send(lifecycle.upload);
          if (fixture.method === 'GET') return reply.code(fixture.status).send(lifecycle.complete);
          const requestedState = String((request.body as { state?: unknown } | undefined)?.state ?? '');
          return reply.code(fixture.status).send(requestedState === 'Aborted' ? lifecycle.aborted : lifecycle.close);
        }
        const body = fixturePayload(
          JSON.parse(await readFile(resolve(root, fixture.file), 'utf8')) as {
            __fixture?: unknown;
            synthetic?: boolean;
          }
        );
        if (fixture.path === '/services/a360/token' && body && typeof body === 'object') {
          (body as Record<string, unknown>).instance_url = `${request.protocol}://${request.host}`;
        }
        return reply.code(fixture.status).send(body);
      },
    });
  }
  return server;
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const server = await buildMockServer();
  const address = await server.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 0) });
  process.stdout.write(`DATA360_MOCK_SERVER=${address}\n`);
  const close = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
