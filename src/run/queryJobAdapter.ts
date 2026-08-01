import type { QueryRowsPageResponse, QueryStatusResponse, QuerySubmitResponse } from './types.js';
import type { QuerySqlOptions } from '../query/options.js';

export type QueryTransport = {
  request<T>(request: { method: 'GET' | 'POST' | 'DELETE'; endpoint: string; body?: unknown }): Promise<T>;
};

export type MappedQueryStatus = {
  terminal: boolean;
  successful: boolean;
  cancelled: boolean;
};

export const mapQueryStatus = (status: string): MappedQueryStatus => {
  const normalized = status.toLowerCase();
  if (normalized === 'resultsproduced' || normalized === 'finished') {
    return { terminal: true, successful: true, cancelled: false };
  }
  if (['failed', 'error'].includes(normalized)) return { terminal: true, successful: false, cancelled: false };
  if (['cancelled', 'canceled', 'aborted'].includes(normalized)) {
    return { terminal: true, successful: false, cancelled: true };
  }
  return { terminal: false, successful: false, cancelled: false };
};

export const encodeQueryId = (queryId: string): string => {
  try {
    // Query IDs are documented as opaque, but the API can return path separators already encoded as %2F.
    return encodeURIComponent(decodeURIComponent(queryId));
  } catch {
    return encodeURIComponent(queryId);
  }
};

export class QueryJobAdapter {
  public constructor(
    private readonly transport: QueryTransport,
    private readonly dataSpace: string,
    private readonly workloadName?: string
  ) {}

  public submit(sql: string, rowLimit: number, options: QuerySqlOptions = {}): Promise<QuerySubmitResponse> {
    return this.transport.request<QuerySubmitResponse>({
      method: 'POST',
      endpoint: this.endpoint('/query-sql'),
      body: {
        sql,
        rowLimit,
        ...(options.sqlParameters ? { sqlParameters: options.sqlParameters } : {}),
        ...(options.querySettings ? { querySettings: options.querySettings } : {}),
      },
    });
  }

  public status(queryId: string): Promise<QueryStatusResponse> {
    return this.transport.request<QueryStatusResponse>({
      method: 'GET',
      endpoint: this.queryEndpoint(queryId),
    });
  }

  public rows(queryId: string, offset: number, rowLimit: number, omitSchema = false): Promise<QueryRowsPageResponse> {
    return this.transport.request<QueryRowsPageResponse>({
      method: 'GET',
      endpoint: this.endpoint(`${this.queryPath(queryId)}/rows`, {
        offset,
        rowLimit,
        ...(omitSchema ? { omitSchema: true } : {}),
      }),
    });
  }

  public async cancel(queryId: string): Promise<void> {
    await this.transport.request<unknown>({ method: 'DELETE', endpoint: this.queryEndpoint(queryId) });
  }

  private queryEndpoint(queryId: string): string {
    return this.endpoint(this.queryPath(queryId));
  }

  private queryPath(queryId: string): string {
    return `/query-sql/${encodeQueryId(queryId)}`;
  }

  private endpoint(path: string, query: Record<string, string | number | boolean> = {}): string {
    const parameters: Array<[string, string]> = [['dataspace', this.dataSpace]];
    if (this.workloadName) parameters.push(['workloadName', this.workloadName]);
    for (const [key, value] of Object.entries(query)) parameters.push([key, String(value)]);
    return `${path}?${parameters.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`;
  }
}
