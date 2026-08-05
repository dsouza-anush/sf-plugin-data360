import { loadCommandMessages } from '../messages.js';
import { SfError } from '@salesforce/core';
import type { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';

const runtimeMessages = loadCommandMessages('data360.runtime.shared.definitionFile');

export const MAX_DEFINITION_BYTES = 10_000_000;

const readBounded = async (source: string, stdin: Readable): Promise<string> => {
  const stream = source === '-' ? stdin : createReadStream(source);
  let raw = '';
  let bytes = 0;
  stream.setEncoding('utf8');
  for await (const chunk of stream) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_DEFINITION_BYTES) {
      stream.destroy();
      throw new Error(runtimeMessages.getMessage('error.RUNTIME_0.0', [String(MAX_DEFINITION_BYTES)]));
    }
    raw += chunk;
  }
  return raw;
};

// Adapted from Jaganpro/sf-cli-plugin-data360 (MIT); errors use this plugin's public contract.
export const loadDefinition = async (
  source: string,
  stdin: Readable = process.stdin
): Promise<Record<string, unknown>> => {
  let raw: string;
  try {
    raw = await readBounded(source, stdin);
  } catch (error) {
    throw new SfError(
      runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.1', [String(source), String((error as Error).message)]),
      'D360_INVALID_DEFINITION',
      [runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.1.actions.1')]
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SfError(
      runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.2', [String((error as Error).message)]),
      'D360_INVALID_DEFINITION',
      [runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.2.actions.1')]
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SfError(runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.3'), 'D360_INVALID_DEFINITION', [
      runtimeMessages.getMessage('error.D360_INVALID_DEFINITION.3.actions.1'),
    ]);
  }

  return parsed as Record<string, unknown>;
};
