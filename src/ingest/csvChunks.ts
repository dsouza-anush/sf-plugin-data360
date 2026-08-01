import { loadCommandMessages } from '../messages.js';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { SfError } from '@salesforce/core';

const runtimeMessages = loadCommandMessages('data360.runtime.ingest.csvChunks');

export type CsvUploadChunk = {
  source: string;
  path: string;
  bytes: number;
};

export const BULK_UPLOAD_CAP_BYTES = 150_000_000;

export async function* splitCsvFiles(
  files: readonly string[],
  options: { maxBytes?: number; preserveHeader?: boolean; signal?: AbortSignal; tempRoot?: string } = {}
): AsyncGenerator<CsvUploadChunk> {
  const maxBytes = options.maxBytes ?? BULK_UPLOAD_CAP_BYTES;
  const preserveHeader = options.preserveHeader ?? true;
  const temporary = await mkdtemp(join(options.tempRoot ?? tmpdir(), 'data360-ingest-'));
  const cleanup = async (): Promise<void> => rm(temporary, { recursive: true, force: true });
  let sequence = 0;
  let activeRecords: AsyncGenerator<{ path: string; bytes: number }> | undefined;
  try {
    for (const file of files) {
      options.signal?.throwIfAborted();
      const records = csvRecordFiles(file, temporary, maxBytes, options.signal);
      activeRecords = records;
      const first = await records.next();
      if (first.done) throw invalid(`${file} is empty.`);
      const headerPath = join(temporary, `header-${sequence++}.csv`);
      let headerBytes = 0;
      let next: IteratorResult<{ path: string; bytes: number }> = first;
      if (preserveHeader) {
        headerBytes = first.value.bytes;
        if (headerBytes >= maxBytes) throw invalid(`The CSV header in ${file} exceeds the ${maxBytes}-byte limit.`);
        await copyFileContents(first.value.path, headerPath, 'wx', options.signal);
        next = await records.next();
      }
      let part = await createPart(temporary, sequence++, preserveHeader ? headerPath : undefined, options.signal);
      let partBytes = headerBytes;
      let recordsInPart = 0;
      for (;;) {
        if (next.done) break;
        const record = next.value;
        if (headerBytes + record.bytes >= maxBytes) {
          throw invalid(`A CSV record in ${file} cannot fit under the ${maxBytes}-byte upload limit.`);
        }
        if (partBytes + record.bytes >= maxBytes) {
          if (recordsInPart === 0) throw invalid(`A CSV record in ${file} exceeds the upload limit.`);
          yield { source: file, path: part, bytes: partBytes };
          await unlink(part);
          part = await createPart(temporary, sequence++, preserveHeader ? headerPath : undefined, options.signal);
          partBytes = headerBytes;
          recordsInPart = 0;
        }
        await appendFileContents(record.path, part, options.signal);
        partBytes += record.bytes;
        recordsInPart += 1;
        next = await records.next();
      }
      if (recordsInPart > 0) {
        yield { source: file, path: part, bytes: partBytes };
      }
      await records.return(undefined);
      activeRecords = undefined;
      await unlink(part).catch(() => undefined);
      if (preserveHeader) await unlink(headerPath).catch(() => undefined);
    }
  } finally {
    await activeRecords?.return(undefined);
    await cleanup();
  }
}

const csvRecordFiles = async function* (
  file: string,
  directory: string,
  maxBytes: number,
  signal?: AbortSignal
): AsyncGenerator<{ path: string; bytes: number }> {
  const path = join(directory, 'record.csv');
  const handle = await open(path, 'w', 0o600);
  let bytes = 0;
  let inQuotes = false;
  try {
    for await (const value of createReadStream(file, { signal })) {
      signal?.throwIfAborted();
      const chunk = value as Buffer;
      let start = 0;
      for (let index = 0; index < chunk.length; index += 1) {
        const byte = chunk[index];
        if (byte === 0x22) inQuotes = !inQuotes;
        if (byte === 0x0a && !inQuotes) {
          const slice = chunk.subarray(start, index + 1);
          await handle.write(slice, 0, slice.length, bytes);
          bytes += slice.length;
          if (bytes >= maxBytes) throw invalid(`A CSV record in ${file} exceeds the ${maxBytes}-byte upload limit.`);
          yield { path, bytes };
          await handle.truncate(0);
          bytes = 0;
          start = index + 1;
        }
      }
      if (start < chunk.length) {
        const slice = chunk.subarray(start);
        await handle.write(slice, 0, slice.length, bytes);
        bytes += slice.length;
        if (bytes >= maxBytes) throw invalid(`A CSV record in ${file} exceeds the ${maxBytes}-byte upload limit.`);
      }
    }
    if (inQuotes) throw invalid(`${file} ends inside a quoted CSV field.`);
    if (bytes > 0) yield { path, bytes };
  } finally {
    await handle.close();
    await unlink(path).catch(() => undefined);
  }
};

const createPart = async (
  directory: string,
  sequence: number,
  header?: string,
  signal?: AbortSignal
): Promise<string> => {
  const path = join(directory, `part-${sequence}.csv`);
  const handle = await open(path, 'wx', 0o600);
  await handle.close();
  if (header) await appendFileContents(header, path, signal);
  return path;
};

const copyFileContents = async (source: string, target: string, flags: 'wx', signal?: AbortSignal): Promise<void> => {
  const handle = await open(target, flags, 0o600);
  await handle.close();
  await appendFileContents(source, target, signal);
};

const appendFileContents = async (source: string, target: string, signal?: AbortSignal): Promise<void> =>
  pipeline(createReadStream(source, { signal }), createWriteStream(target, { flags: 'a', mode: 0o600 }), { signal });

const invalid = (message: string): SfError =>
  new SfError(message, 'D360_INVALID_DEFINITION', [
    runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.0.actions.1'),
  ]);
