import type { QueryRowsPageResponse, QueryRowsResponse } from '../run/types.js';

export type QueryRowsReader = {
  rows(queryId: string, offset: number, rowLimit: number, omitSchema?: boolean): Promise<QueryRowsPageResponse>;
};

export type FetchQueryRowsOptions = {
  offset: number;
  rowLimit: number;
  all: boolean;
  omitSchema?: boolean;
};

export const normalizeQueryPage = (page: QueryRowsPageResponse): QueryRowsPageResponse => {
  const data = Array.isArray(page.data) ? page.data : [];
  return {
    ...page,
    data,
    metadata: Array.isArray(page.metadata) ? page.metadata : undefined,
    returnedRows: data.length,
  };
};

export async function* iterateQueryPages(
  adapter: QueryRowsReader,
  queryId: string,
  options: FetchQueryRowsOptions
): AsyncGenerator<QueryRowsPageResponse> {
  let offset = options.offset;
  let fetching = true;
  while (fetching) {
    const page = normalizeQueryPage(await adapter.rows(queryId, offset, options.rowLimit, options.omitSchema));
    yield page;
    offset += page.returnedRows;
    fetching = options.all && page.returnedRows === options.rowLimit && page.returnedRows > 0;
  }
}

export const fetchQueryRows = async (
  adapter: QueryRowsReader,
  queryId: string,
  options: FetchQueryRowsOptions
): Promise<QueryRowsResponse> => {
  let metadata: QueryRowsResponse['metadata'] = [];
  const data: unknown[][] = [];
  for await (const page of iterateQueryPages(adapter, queryId, options)) {
    if (metadata.length === 0 && page.metadata) metadata = page.metadata;
    data.push(...(page.data ?? []));
  }
  return { data, metadata, returnedRows: data.length };
};
