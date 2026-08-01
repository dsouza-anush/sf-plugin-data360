import Fastify, { type FastifyInstance } from 'fastify';
import type { IngestJob } from '../../src/ingest/client.js';

export type IngestMockControl = {
  job: IngestJob;
  statusQueue: IngestJob[];
  abortRace: boolean;
  validationFailure: boolean;
  stallUpload: boolean;
  uploadStarted?: () => void;
  requests: Array<{ method: string; url: string; body: unknown }>;
};

export const buildIngestMockServer = async (): Promise<{
  server: FastifyInstance;
  control: IngestMockControl;
}> => {
  const server = Fastify({ logger: false });
  server.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) =>
    done(null, body)
  );
  server.addContentTypeParser('text/csv', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  const control: IngestMockControl = {
    job: { id: 'synthetic-job', state: 'Open', recordsProcessed: 0, recordsFailed: 0 },
    statusQueue: [],
    abortRace: false,
    validationFailure: false,
    stallUpload: false,
    requests: [],
  };
  server.addHook('preHandler', async (request) => {
    control.requests.push({ method: request.method, url: request.url, body: request.body });
  });
  server.post('/services/a360/token', async (request) => ({
    access_token: 'synthetic-tenant-token',
    instance_url: `${request.protocol}://${request.host}`,
    expires_in: 3600,
    scope: 'cdp_ingest_api cdp_api',
  }));
  server.post('/api/v1/ingest/sources/:source/:object/actions/test', async (_request, reply) =>
    control.validationFailure
      ? reply.code(400).send({
          message: 'Synthetic validation failure.',
          validationReport: { errors: [{ field: 'ext_id', message: 'Required.' }] },
        })
      : reply.send({ valid: true })
  );
  server.post('/api/v1/ingest/sources/:source/:object', async (_request, reply) =>
    reply.code(202).send({ accepted: true })
  );
  server.delete('/api/v1/ingest/sources/:source/:object', async (_request, reply) =>
    reply.code(202).send({ accepted: true })
  );
  server.post('/api/v1/ingest/jobs', async (_request, reply) => {
    control.job = { id: 'synthetic-job', state: 'Open', recordsProcessed: 0, recordsFailed: 0 };
    return reply.code(201).send(control.job);
  });
  server.put('/api/v1/ingest/jobs/:id/batches', async (_request, reply) => {
    if (control.stallUpload) {
      control.uploadStarted?.();
      await new Promise<void>((resolve) => reply.raw.once('close', resolve));
      return reply;
    }
    return reply.code(202).send({ accepted: true });
  });
  server.patch('/api/v1/ingest/jobs/:id', async (request, reply) => {
    const state = (request.body as { state?: string }).state;
    if (state === 'Aborted' && control.abortRace) {
      control.job = { ...control.job, state: 'JobComplete' };
      return reply.code(409).send({ message: 'Job already completed.' });
    }
    control.job = { ...control.job, state: state ?? control.job.state };
    return reply.send(control.job);
  });
  server.get('/api/v1/ingest/jobs/:id', async () => control.statusQueue.shift() ?? control.job);
  return { server, control };
};
