import { SfError } from '@salesforce/core';
import { loadCommandMessages } from '../messages.js';

const messages = loadCommandMessages('data360.runtime.ingest.errors');

export const attachIngestJobError = (error: Error, jobId: string, actions: string[]): SfError<{ jobId: string }> => {
  const result =
    error instanceof SfError
      ? error
      : new SfError(
          error.message,
          'D360_API_ERROR',
          actions.length > 0 ? [] : [messages.getMessage('fallback-action')],
          error
        );
  result.data = { ...(result.data ?? {}), jobId };
  result.actions = [...(result.actions ?? []), ...actions];
  return result as SfError<{ jobId: string }>;
};

export const failedRecordHint = (jobId: string): string => messages.getMessage('failed-record-hint', [jobId, jobId]);
