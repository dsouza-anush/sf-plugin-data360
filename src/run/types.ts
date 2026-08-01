import { loadCommandMessages } from '../messages.js';
import type { Readable } from 'node:stream';
import { SfError } from '@salesforce/core';
import { readInput } from '../shared/input.js';
import type { ResultFormat } from '../shared/types.js';

const runtimeMessages = loadCommandMessages('data360.runtime.run.types');

export const DEFAULT_QUERY_ROW_LIMIT = 5000;

export type QueryMetadata = {
  name: string;
  nullable?: boolean;
  placeInOrder?: number;
  type: string;
};

export type QueryRowsResponse = {
  data: unknown[][];
  metadata: QueryMetadata[];
  returnedRows: number;
};

export type QueryRowsPageResponse = {
  data: unknown[][];
  metadata?: QueryMetadata[];
  returnedRows: number;
};

export type QueryStatusResponse = {
  chunkCount?: number;
  completionStatus: string;
  expirationTime?: string;
  progress?: number;
  queryId: string;
  rowCount?: number;
  rowsProcessed?: number;
  stalenessReasons?: string[];
  wallClockTime?: number;
};

export type QuerySubmitResponse = {
  data?: unknown[][];
  metadata?: QueryMetadata[];
  returnedRows?: number;
  status: QueryStatusResponse;
};

export type QueryJobCacheEntry = {
  id: string;
  username: string;
  apiVersion: string;
  dataSpace: string;
  workloadName?: string;
  submittedAt: string;
  output?: {
    format: ResultFormat;
    file?: string;
  };
};

export type QueryCommandResult = {
  queryId: string;
  status: string;
  done: boolean;
  rowCount?: number;
  columns?: Array<{ name: string; type: string }>;
  rows?: unknown[][];
};

export type QueryInputOptions = {
  query?: string;
  file?: string;
  stdin: Readable;
  stdinIsTTY?: boolean;
};

export const resolveQueryInput = async (options: QueryInputOptions): Promise<string> => {
  const hasPipedStdin = options.stdinIsTTY === false;
  const selected =
    Number(options.query !== undefined) +
    Number(options.file !== undefined) +
    Number(hasPipedStdin && options.file !== '-');
  if (selected !== 1) {
    throw new SfError(
      selected === 0
        ? runtimeMessages.getMessage('error.D360_QUERY_SYNTAX.0.none')
        : runtimeMessages.getMessage('error.D360_QUERY_SYNTAX.0.multiple'),
      'D360_QUERY_SYNTAX',
      [runtimeMessages.getMessage('error.D360_QUERY_SYNTAX.0.actions.1')]
    );
  }

  const value =
    options.query ??
    (options.file !== undefined ? await readInput(options.file, options.stdin) : await readInput('-', options.stdin));
  if (value.trim().length === 0) {
    throw new SfError(runtimeMessages.getMessage('error.D360_QUERY_SYNTAX.1'), 'D360_QUERY_SYNTAX', [
      runtimeMessages.getMessage('error.D360_QUERY_SYNTAX.1.actions.1'),
    ]);
  }
  return value;
};
