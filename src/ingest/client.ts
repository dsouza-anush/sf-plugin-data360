import { loadCommandMessages } from '../messages.js';
import type { DirectClient } from '../client/directClient.js';
import type { Readable } from 'node:stream';

const runtimeMessages = loadCommandMessages('data360.runtime.ingest.client');

export type IngestJob = {
  id: string;
  state: string;
  recordsProcessed?: number;
  recordsFailed?: number;
  createdDate?: string;
  lastModifiedDate?: string;
  [key: string]: unknown;
};

export type IngestCancelResult = IngestJob & { cancelled: boolean };

const segment = (value: string): string => encodeURIComponent(value);

export class IngestClient {
  public constructor(private readonly direct: DirectClient) {}

  public stream(source: string, object: string, body: { data: Array<Record<string, unknown>> }): Promise<unknown> {
    return this.direct.request({
      method: 'POST',
      endpoint: `/api/v1/ingest/sources/${segment(source)}/${segment(object)}`,
      body,
    });
  }

  public validate(source: string, object: string, body: { data: Array<Record<string, unknown>> }): Promise<unknown> {
    return this.direct.request({
      method: 'POST',
      endpoint: `/api/v1/ingest/sources/${segment(source)}/${segment(object)}/actions/test`,
      body,
    });
  }

  public delete(source: string, object: string, ids: string[]): Promise<{ accepted: boolean }> {
    return this.direct.request<{ accepted: boolean }>({
      method: 'DELETE',
      endpoint: `/api/v1/ingest/sources/${segment(source)}/${segment(object)}`,
      body: { ids },
    });
  }

  public create(source: string, object: string, operation: 'upsert' | 'delete'): Promise<IngestJob> {
    return this.direct.post('/api/v1/ingest/jobs', { sourceName: source, object, operation });
  }

  public upload(id: string, body: Uint8Array | (() => Readable), signal?: AbortSignal): Promise<unknown> {
    return this.direct.request({
      method: 'PUT',
      endpoint: `/api/v1/ingest/jobs/${segment(id)}/batches`,
      rawBody: body,
      contentType: 'text/csv',
      signal,
    });
  }

  public close(id: string): Promise<IngestJob> {
    return this.direct.request({
      method: 'PATCH',
      endpoint: `/api/v1/ingest/jobs/${segment(id)}`,
      body: { state: 'UploadComplete' },
    });
  }

  public status(id: string): Promise<IngestJob> {
    return this.direct.get(`/api/v1/ingest/jobs/${segment(id)}`);
  }

  public abort(id: string): Promise<IngestJob> {
    return this.direct.request({
      method: 'PATCH',
      endpoint: `/api/v1/ingest/jobs/${segment(id)}`,
      body: { state: 'Aborted' },
    });
  }
}

const cancelResult = (job: IngestJob): IngestCancelResult => ({
  ...job,
  cancelled: job.state.toLowerCase() === 'aborted',
});

const assertJobIdentity = (job: IngestJob, expectedId: string): IngestJob => {
  if (job.id !== expectedId) {
    throw new Error(runtimeMessages.getMessage('error.RUNTIME_0.0', [job.id || '<missing>', expectedId]));
  }
  return job;
};

export const cancelIngestJob = async (client: IngestClient, id: string): Promise<IngestCancelResult> => {
  const current = assertJobIdentity(await client.status(id), id);
  if (['jobcomplete', 'failed', 'aborted'].includes(current.state.toLowerCase())) return cancelResult(current);
  try {
    return cancelResult(assertJobIdentity(await client.abort(id), id));
  } catch (error) {
    if ((error as { data?: { httpStatus?: number } }).data?.httpStatus !== 409) throw error;
    const raced = assertJobIdentity(await client.status(id), id);
    if (['jobcomplete', 'aborted'].includes(raced.state.toLowerCase())) return cancelResult(raced);
    throw error;
  }
};

export const mapIngestState = (job: IngestJob): { terminal: boolean; successful: boolean; label: string } => ({
  terminal: ['jobcomplete', 'failed', 'aborted'].includes(job.state.toLowerCase()),
  successful: job.state.toLowerCase() === 'jobcomplete',
  label: job.state,
});
