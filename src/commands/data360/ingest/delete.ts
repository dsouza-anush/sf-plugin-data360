import { loadCommandMessages } from '../../../messages.js';
import { access, open } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { Flags } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { Data360Command } from '../../../command/Data360Command.js';
import { directClient } from '../../../ingest/context.js';
import { IngestClient } from '../../../ingest/client.js';
import {
  apiVersionFlag,
  noPromptFlag,
  objectNameFlag,
  sourceNameFlag,
  targetOrgFlag,
  timingFlag,
} from '../../../shared/flags.js';
import { STREAMING_PAYLOAD_CAP_BYTES } from '../../../ingest/recordChunks.js';

const commandMessages = loadCommandMessages('data360.ingest.delete');

const readBounded = async (input: Readable, maxBytes = STREAMING_PAYLOAD_CAP_BYTES): Promise<string> => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.byteLength;
    if (bytes >= maxBytes) {
      throw invalidDelete(`The delete ID input must be smaller than ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes).toString('utf8');
};

const readIds = async (values: string[] | undefined, file: string | undefined): Promise<string[]> => {
  if (values) return values;
  const handle = file === '-' ? undefined : await open(file!, 'r');
  let text: string;
  try {
    text = await readBounded(handle?.createReadStream() ?? process.stdin);
  } finally {
    await handle?.close();
  }
  return parseDeleteIdText(text);
};

export const parseDeleteIdText = (text: string): string[] => {
  const trimmed = text.trim();
  const looksLikeJson = ['[', '{', '"', '-'].includes(trimmed[0]) || /^(?:null|true|false|\d)/u.test(trimmed);
  if (looksLikeJson) {
    let value: unknown;
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch (error) {
      throw invalidDelete(`The delete ID file contains malformed JSON: ${(error as Error).message}`);
    }
    if (!Array.isArray(value)) throw invalidDelete('A JSON delete ID file must contain a top-level array.');
    return value as string[];
  }
  return trimmed
    .split(/\r?\n|,/u)
    .map((value) => value.trim())
    .filter(Boolean);
};

const invalidDelete = (message: string): SfError =>
  new SfError(message, 'D360_INVALID_DEFINITION', [
    commandMessages.getMessage('error.D360_INVALID_DEFINITION.0.actions.1'),
    commandMessages.getMessage('error.D360_INVALID_DEFINITION.0.actions.2'),
  ]);

export const validateDeleteIds = (ids: string[]): string[] => {
  if (
    ids.length < 1 ||
    ids.length > 200 ||
    ids.some((id) => typeof id !== 'string' || id.trim().length === 0) ||
    Buffer.byteLength(JSON.stringify({ ids })) >= STREAMING_PAYLOAD_CAP_BYTES
  ) {
    throw invalidDelete('Streaming delete requires 1 to 200 string IDs in a request smaller than 200,000 bytes.');
  }
  return ids;
};

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class IngestDelete extends Data360Command<{ accepted: boolean }> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    'source-name': sourceNameFlag,
    'object-name': objectNameFlag,
    ids: Flags.string({
      multiple: true,
      exactlyOne: ['ids', 'file'],
      summary: commandMessages.getMessage('flags.ids.summary'),
    }),
    file: Flags.string({
      char: 'f',
      exactlyOne: ['ids', 'file'],
      parse: async (value) => {
        if (value !== '-') await access(value);
        return value;
      },
      summary: commandMessages.getMessage('flags.file.summary'),
    }),
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };
  public async run(): Promise<{ accepted: boolean }> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(IngestDelete),
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => flags.timing,
    });
    const { flags } = initialized.parsed;
    const ids = validateDeleteIds(await readIds(flags.ids, flags.file));
    await this.confirmDestructive(
      Boolean(flags['no-prompt']),
      commandMessages.getMessage('prompt.delete', [ids.length, flags['object-name']])
    );
    const direct = await directClient(flags['target-org'], initialized.connection, initialized.requestTiming);
    try {
      return await new IngestClient(direct.client).delete(flags['source-name'], flags['object-name'], ids);
    } finally {
      await direct.close();
    }
  }
}
