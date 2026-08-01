import { loadCommandMessages } from '../messages.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { SfError } from '@salesforce/core';
import { mapQueryStatus } from './queryJobAdapter.js';
import type { QueryStatusResponse } from './types.js';

const runtimeMessages = loadCommandMessages('data360.runtime.run.jobRunner');

export type QueryStatusReader = {
  status(queryId: string): Promise<QueryStatusResponse>;
};

export type RunQueryJobOptions = {
  timeoutMs: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<unknown>;
  onStatus?: (status: QueryStatusResponse) => void;
};

export type JobState = { terminal: boolean; successful: boolean; label: string };

export const runJob = async <T>(
  read: () => Promise<T>,
  options: {
    timeoutMs: number;
    map: (status: T) => JobState;
    jobId: string;
    family: string;
    resumeCommand: string;
    failureAction: string;
    pollIntervalMs?: number;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<unknown>;
    onStatus?: (status: T) => void;
  }
): Promise<T> => {
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? sleep;
  const started = now();
  for (;;) {
    const status = await read();
    options.onStatus?.(status);
    const mapped = options.map(status);
    if (mapped.successful) return status;
    if (mapped.terminal) {
      const error = new SfError(
        runtimeMessages.getMessage('error.D360_JOB_FAILED.0', [
          String(options.family),
          String(options.jobId),
          String(mapped.label),
        ]),
        'D360_JOB_FAILED',
        [options.failureAction]
      ) as SfError<{ jobId: string }>;
      error.data = { jobId: options.jobId };
      throw error;
    }
    if (now() - started >= options.timeoutMs) {
      const error = new SfError(
        runtimeMessages.getMessage('error.D360_JOB_TIMEOUT.1', [String(options.family), String(options.jobId)]),
        'D360_JOB_TIMEOUT',
        [runtimeMessages.getMessage('error.D360_JOB_TIMEOUT.1.actions.1', [String(options.resumeCommand)])],
        69
      ) as SfError<{ jobId: string }>;
      error.data = { jobId: options.jobId };
      throw error;
    }
    await wait(options.pollIntervalMs ?? 1000);
  }
};

export const runQueryJob = async (
  adapter: QueryStatusReader,
  queryId: string,
  options: RunQueryJobOptions
): Promise<QueryStatusResponse> => {
  return runJob(() => adapter.status(queryId), {
    ...options,
    jobId: queryId,
    family: 'Query',
    resumeCommand: 'sf data360 query resume -r',
    failureAction: `Run sf data360 query results -i "${queryId}" to inspect available results.`,
    map: (status) => ({ ...mapQueryStatus(status.completionStatus), label: status.completionStatus }),
  });
};
