import { readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';

export const readInput = async (source: string, stdin: Readable = process.stdin): Promise<string> => {
  if (source !== '-') return readFile(source, 'utf8');

  let value = '';
  stdin.setEncoding('utf8');
  for await (const chunk of stdin) value += chunk;
  return value;
};
