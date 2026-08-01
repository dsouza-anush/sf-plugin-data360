import { loadCommandMessages } from '../messages.js';

const runtimeMessages = loadCommandMessages('data360.runtime.client.pagination');

export type Page<T> = {
  data: T[];
  totalSize?: number;
  nextBatchId?: string;
  nextPageUrl?: string;
};

export type PageRequest = {
  offset: number;
  pageSize: number;
  cursor?: string;
  nextPageUrl?: string;
};

export type PaginationOptions = {
  pageSize?: number;
  limit?: number;
};

export async function* paginate<T>(
  fetchPage: (request: PageRequest) => Promise<Page<T>>,
  options: PaginationOptions = {}
): AsyncGenerator<T> {
  const pageSize = options.pageSize ?? 200;
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const cursors = new Set<string>();
  const urls = new Set<string>();
  const offsetPages = new Set<string>();
  let request: PageRequest = { offset: 0, pageSize };
  let emitted = 0;

  while (emitted < limit) {
    const page = await fetchPage(request);
    if (!page.nextPageUrl && !page.nextBatchId && page.data.length > 0) {
      const pageKey = JSON.stringify(page.data);
      if (offsetPages.has(pageKey))
        throw new Error(runtimeMessages.getMessage('error.RUNTIME_2.2', [String(request.offset)]));
      offsetPages.add(pageKey);
    }
    for (const item of page.data) {
      yield item;
      emitted += 1;
      if (emitted >= limit) return;
    }

    if (page.nextPageUrl) {
      if (urls.has(page.nextPageUrl))
        throw new Error(runtimeMessages.getMessage('error.RUNTIME_0.0', [String(page.nextPageUrl)]));
      urls.add(page.nextPageUrl);
      request = { offset: request.offset + page.data.length, pageSize, nextPageUrl: page.nextPageUrl };
      continue;
    }

    if (page.nextBatchId) {
      if (cursors.has(page.nextBatchId))
        throw new Error(runtimeMessages.getMessage('error.RUNTIME_1.1', [String(page.nextBatchId)]));
      cursors.add(page.nextBatchId);
      request = { offset: request.offset + page.data.length, pageSize, cursor: page.nextBatchId };
      continue;
    }

    const nextOffset = request.offset + page.data.length;
    if (page.data.length === 0 || (page.totalSize !== undefined && nextOffset >= page.totalSize)) return;
    // Some collection endpoints ignore the requested page size and return the complete
    // collection without total or continuation metadata. A differently sized page is
    // terminal; requesting another offset can repeat that same collection forever.
    if (page.totalSize === undefined && page.data.length !== pageSize) return;
    request = { offset: nextOffset, pageSize };
  }
}
