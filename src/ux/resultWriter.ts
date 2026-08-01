import { rename, rm } from 'node:fs/promises';
import { createWriteStream, type WriteStream } from 'node:fs';
import { once } from 'node:events';
import type { QueryRowsPageResponse, QueryRowsResponse } from '../run/types.js';
import { atomicTemporaryPath, writeFileAtomic } from '../shared/atomicFile.js';
import type { ResultFormat } from '../shared/types.js';
import { toCsv } from './csv.js';
import { humanResult } from './queryResult.js';

export const formatQueryResult = (response: QueryRowsResponse, format: ResultFormat): string => {
  if (format === 'csv') return toCsv(response.metadata, response.data);
  if (format === 'json') return `${JSON.stringify(response.data, undefined, 2)}\n`;
  return humanResult(response);
};

export const writeQueryResult = async (
  response: QueryRowsResponse,
  format: ResultFormat,
  outputFile?: string,
  stdout: NodeJS.WritableStream = process.stdout
): Promise<void> => {
  const formatted = formatQueryResult(response, format);
  if (!outputFile) {
    stdout.write(formatted);
    return;
  }
  await writeFileAtomic(outputFile, formatted);
};

const writeChunk = async (stream: NodeJS.WritableStream, chunk: string): Promise<void> => {
  if (!stream.write(chunk)) await once(stream, 'drain');
};

export const writeQueryPages = async (
  pages: AsyncIterable<QueryRowsPageResponse>,
  format: ResultFormat,
  outputFile?: string,
  stdout: NodeJS.WritableStream = process.stdout
): Promise<number> => {
  const temporary = outputFile ? atomicTemporaryPath(outputFile) : undefined;
  const stream = temporary ? createWriteStream(temporary, { flags: 'wx', mode: 0o600 }) : stdout;
  let rows = 0;
  let firstPage = true;
  try {
    if (format === 'json') await writeChunk(stream, '[\n');
    for await (const page of pages) {
      const data = page.data ?? [];
      const metadata = page.metadata ?? [];
      const returnedRows = data.length;
      if (format === 'csv') {
        const csv = toCsv(metadata, data);
        await writeChunk(stream, firstPage ? csv : csv.slice(csv.indexOf('\r\n') + 2));
      } else if (format === 'json') {
        for (const row of data) {
          await writeChunk(stream, `${rows === 0 ? '' : ',\n'}  ${JSON.stringify(row)}`);
          rows += 1;
        }
      } else {
        const human = humanResult({ ...page, data, metadata, returnedRows });
        await writeChunk(stream, firstPage ? human : human.slice(human.indexOf('\n') + 1));
      }
      if (format !== 'json') rows += returnedRows;
      firstPage = false;
    }
    if (format === 'json') await writeChunk(stream, '\n]\n');
    if (temporary) {
      const fileStream = stream as WriteStream;
      const closed = once(fileStream, 'close');
      fileStream.end();
      await closed;
      await rename(temporary, outputFile!);
    }
    return rows;
  } catch (error) {
    if (temporary) {
      const fileStream = stream as WriteStream;
      if (!fileStream.closed) {
        const closed = once(fileStream, 'close');
        fileStream.destroy();
        await closed.catch(() => undefined);
      }
      await rm(temporary, { force: true });
    }
    throw error;
  }
};
