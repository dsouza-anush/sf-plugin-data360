import { loadCommandMessages } from '../messages.js';
import type { Readable } from 'node:stream';
import { SfError } from '@salesforce/core';

const runtimeMessages = loadCommandMessages('data360.runtime.ingest.recordChunks');

export const STREAMING_PAYLOAD_CAP_BYTES = 200_000;

export async function* chunkIngestRecords(
  input: Readable,
  options: { maxBytes?: number } = {}
): AsyncGenerator<{ data: Array<Record<string, unknown>> }> {
  const maxBytes = options.maxBytes ?? STREAMING_PAYLOAD_CAP_BYTES;
  let batch: Array<Record<string, unknown>> = [];
  for await (const record of parseRecords(input, maxBytes)) {
    const candidate = { data: [...batch, record] };
    if (Buffer.byteLength(JSON.stringify(candidate)) >= maxBytes) {
      if (batch.length === 0) throw invalid(`A record exceeds the ${maxBytes}-byte streaming payload limit.`);
      yield { data: batch };
      batch = [record];
      if (Buffer.byteLength(JSON.stringify({ data: batch })) >= maxBytes) {
        throw invalid(`A record exceeds the ${maxBytes}-byte streaming payload limit.`);
      }
    } else {
      batch.push(record);
    }
  }
  if (batch.length > 0) yield { data: batch };
}

const parseRecords = async function* (input: Readable, maxBytes: number): AsyncGenerator<Record<string, unknown>> {
  input.setEncoding('utf8');
  const chunks = input[Symbol.asyncIterator]();
  let prefix = '';
  while (!/\S/u.test(prefix)) {
    const next = await chunks.next();
    if (next.done) throw invalid('The ingestion input is empty.');
    const value = String(next.value);
    if (Buffer.byteLength(prefix) + Buffer.byteLength(value) >= maxBytes) {
      const first = prefix.match(/\S/u)?.[0] ?? value.match(/\S/u)?.[0];
      const label = first === '[' ? 'JSON array record 1' : 'NDJSON record 1';
      throw invalid(`${label} exceeds the ${maxBytes}-byte streaming payload limit.`);
    }
    prefix += value;
  }
  const values = (async function* (): AsyncGenerator<string> {
    yield prefix;
    for (;;) {
      const next = await chunks.next();
      if (next.done) return;
      yield String(next.value);
    }
  })();
  const first = prefix.match(/\S/u)?.[0];
  yield* first === '[' ? parseArray(values, maxBytes) : parseNdjson(values, maxBytes);
};

const parseNdjson = async function* (
  chunks: AsyncIterable<string>,
  maxBytes: number
): AsyncGenerator<Record<string, unknown>> {
  let line = '';
  let lineBytes = 0;
  let lineNumber = 0;
  for await (const chunk of chunks) {
    let start = 0;
    let newline = chunk.indexOf('\n', start);
    while (newline >= 0) {
      const segment = chunk.slice(start, newline);
      const segmentBytes = Buffer.byteLength(segment);
      if (lineBytes + segmentBytes >= maxBytes) {
        throw invalid(`NDJSON record ${lineNumber + 1} exceeds the ${maxBytes}-byte streaming payload limit.`);
      }
      line += segment;
      lineBytes += segmentBytes;
      lineNumber += 1;
      const value = line.trim();
      line = '';
      lineBytes = 0;
      if (value) yield parseObject(value, `NDJSON record ${lineNumber}`);
      start = newline + 1;
      newline = chunk.indexOf('\n', start);
    }
    const remainder = chunk.slice(start);
    const remainderBytes = Buffer.byteLength(remainder);
    if (lineBytes + remainderBytes >= maxBytes) {
      throw invalid(`NDJSON record ${lineNumber + 1} exceeds the ${maxBytes}-byte streaming payload limit.`);
    }
    line += remainder;
    lineBytes += remainderBytes;
  }
  if (line.trim()) yield parseObject(line.trim(), `NDJSON record ${lineNumber + 1}`);
};

const parseArray = async function* (
  chunks: AsyncIterable<string>,
  maxBytes: number
): AsyncGenerator<Record<string, unknown>> {
  let started = false;
  let ended = false;
  let value = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  let index = 0;
  for await (const chunk of chunks) {
    for (const character of chunk) {
      if (!started) {
        if (/\s/u.test(character)) continue;
        if (character !== '[') throw invalid('Expected a JSON array or NDJSON object records.');
        started = true;
        continue;
      }
      if (ended) {
        if (!/\s/u.test(character)) throw invalid('Unexpected content after the JSON array.');
        continue;
      }
      if (inString) {
        value += character;
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        value += character;
      } else if (character === '{' || character === '[') {
        depth += 1;
        value += character;
      } else if (character === '}' || (character === ']' && depth > 0)) {
        depth -= 1;
        value += character;
        if (depth < 0) throw invalid('Malformed JSON array input.');
      } else if ((character === ',' || character === ']') && depth === 0) {
        const trimmed = value.trim();
        if (trimmed) {
          index += 1;
          yield parseObject(trimmed, `JSON array record ${index}`);
          value = '';
        } else if (character === ',' || index > 0) {
          throw invalid('Malformed JSON array input.');
        }
        if (character === ']') ended = true;
      } else {
        value += character;
      }
      if (Buffer.byteLength(value) > maxBytes) {
        throw invalid(`JSON array record ${index + 1} exceeds the ${maxBytes}-byte streaming payload limit.`);
      }
    }
  }
  if (!started || !ended || inString || depth !== 0) throw invalid('Malformed or incomplete JSON array input.');
};

const parseObject = (text: string, label: string): Record<string, unknown> => {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw invalid(`${label} contains malformed JSON: ${(error as Error).message}`);
  }
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw invalid(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
};

const invalid = (message: string): SfError =>
  new SfError(message, 'D360_INVALID_DEFINITION', [
    runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.0.actions.1'),
  ]);
