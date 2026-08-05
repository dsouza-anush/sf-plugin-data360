import { SfError } from '@salesforce/core';
import { redactSecretString } from '../shared/redact.js';
import { terminalSafeText } from '../ux/terminal.js';

export const D360_ERROR_CODES = [
  'D360_API_ERROR',
  'D360_AUTH_EXPIRED',
  'D360_CONFIRMATION_REQUIRED',
  'D360_INVALID_DEFINITION',
  'D360_JOB_FAILED',
  'D360_JOB_TIMEOUT',
  'D360_NAME_AMBIGUOUS',
  'D360_NAME_NOT_FOUND',
  'D360_NOT_FOUND',
  'D360_NOT_PROVISIONED',
  'D360_QUERY_SYNTAX',
  'D360_RATE_LIMITED',
  'D360_SCOPE_MISSING',
  'D360_TOKEN_EXCHANGE_FAILED',
  'D360_UNSUPPORTED_OP',
] as const;

export type D360ErrorCode = (typeof D360_ERROR_CODES)[number];
export type ApiErrorContext = {
  family?: 'core' | 'direct';
  requiredScope?: string;
  actionTimeout?: {
    label: string;
    recoveryCommand: string;
  };
};

export type NormalizedError = {
  httpStatus: number;
  apiCode: string;
  message: string;
  detail: string;
  endpoint: string;
  outcomeUnknown?: boolean;
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const firstNumber = (...values: unknown[]): number | undefined =>
  values.find((value): value is number => typeof value === 'number');

const NOT_FOUND_API_CODES = new Set(['ITEM_NOT_FOUND', 'NOT_FOUND']);
const isTimeoutError = (error: unknown, message: string): boolean => {
  const outer = record(error);
  const cause = record(outer.cause);
  return (
    outer.name === 'AbortError' ||
    cause.name === 'AbortError' ||
    /\b(?:timed?\s*out|timeout|aborted due to timeout)\b/iu.test(message)
  );
};

export const normalizeErrorShape = (error: unknown): NormalizedError => {
  const outer = record(error);
  const errorData = record(outer.data);
  const response = record(outer.response);
  const dataResponse = record(errorData.response);
  const rawBody = outer.body ?? errorData.body ?? outer.data;
  const first = Array.isArray(rawBody) ? rawBody[0] : rawBody;
  const body = record(first);
  const nested = record(body.error);
  const httpStatus = firstNumber(
    outer.statusCode,
    outer.status,
    errorData.httpStatus,
    errorData.statusCode,
    errorData.status,
    response.statusCode,
    response.status,
    dataResponse.statusCode,
    dataResponse.status,
    body.httpStatus,
    body.statusCode,
    body.status
  );
  const apiCode =
    String(
      body.errorCode ??
        body.apiCode ??
        body.code ??
        nested.errorCode ??
        nested.apiCode ??
        nested.code ??
        errorData.errorCode ??
        errorData.apiCode ??
        errorData.code ??
        outer.errorCode ??
        outer.code ??
        ''
    ) || undefined;
  const safeApiCode = apiCode && /^[A-Z\d_.-]{1,80}$/iu.test(apiCode) ? apiCode : '';
  const messageValue =
    body.message ??
    nested.message ??
    errorData.message ??
    outer.message ??
    (error instanceof Error ? error.message : error);
  return {
    httpStatus: httpStatus ?? 0,
    apiCode: safeApiCode,
    message: terminalSafeText(redactSecretString(String(messageValue))),
    detail: '',
    endpoint: typeof outer.endpoint === 'string' ? outer.endpoint : '',
  };
};

const localMessage = (name: string): string => {
  const messages: Record<string, string> = {
    D360_API_ERROR: 'The Data 360 API request failed.',
    D360_AUTH_EXPIRED: 'The Salesforce authentication is no longer valid.',
    D360_INVALID_DEFINITION: 'The Data 360 definition is invalid.',
    D360_JOB_TIMEOUT: 'The Data 360 action did not return before the client timeout.',
    D360_NOT_FOUND: 'The requested Data 360 resource was not found.',
    D360_NOT_PROVISIONED: 'Data 360 is not provisioned or available for this org.',
    D360_QUERY_SYNTAX: 'The Data 360 query is invalid.',
    D360_RATE_LIMITED: 'The Data 360 API rate limit was reached.',
    D360_SCOPE_MISSING: 'The authorization is missing a required Data 360 scope.',
  };
  return messages[name] ?? messages.D360_API_ERROR;
};

export const normalizeApiError = (
  error: unknown,
  endpoint?: string,
  context: ApiErrorContext = {}
): SfError<NormalizedError> => {
  const data = normalizeErrorShape(error);
  if (endpoint) data.endpoint = endpoint;
  const isStructuredNotFound = NOT_FOUND_API_CODES.has(data.apiCode.toUpperCase());
  let name = 'D360_API_ERROR';
  let actions = ['Re-run with --json to inspect the structured API error details.'];
  let exitCode: number | undefined;
  if (data.httpStatus === 0 && context.actionTimeout && isTimeoutError(error, data.message)) {
    name = 'D360_JOB_TIMEOUT';
    exitCode = 69;
    data.message = `The ${context.actionTimeout.label} request did not return before the client timeout. Its server-side outcome is unknown.`;
    data.outcomeUnknown = true;
    actions = [
      'Do not retry until you check the resource status; the server may have accepted this billable or mutating action.',
      context.actionTimeout.recoveryCommand,
    ];
  } else if (data.httpStatus === 401) {
    name = 'D360_AUTH_EXPIRED';
    actions = ['Authenticate again with sf org login web --alias <alias> --instance-url <my-domain-url>.'];
  } else if (isStructuredNotFound) {
    name = 'D360_NOT_FOUND';
    actions = ['Confirm the resource name or ID and try again.'];
  } else if (data.httpStatus === 403 && context.family === 'direct') {
    name = 'D360_SCOPE_MISSING';
    const scope = context.requiredScope ?? 'cdp_api';
    actions = [
      `Add the ${scope} scope to the External Client App and authorize the org again.`,
      'Run sf data360 doctor to verify Direct API scopes.',
    ];
  } else if (data.httpStatus === 429) {
    name = 'D360_RATE_LIMITED';
    actions = ['Wait before retrying the request.'];
  } else if (
    (data.httpStatus === 403 || data.httpStatus === 404) &&
    context.family !== 'direct' &&
    (data.endpoint.includes('/metadata') || data.apiCode === 'NOT_PROVISIONED')
  ) {
    name = 'D360_NOT_PROVISIONED';
    actions = ['Confirm Data 360 is provisioned in this org.', 'Run sf data360 doctor for setup diagnostics.'];
  } else if (
    data.httpStatus === 400 &&
    (data.endpoint.includes('/query-sql') || ['MALFORMED_QUERY', 'QUERY_SYNTAX'].includes(data.apiCode))
  ) {
    name = 'D360_QUERY_SYNTAX';
    actions = ['Correct the SQL syntax and run the query again.'];
  } else if (data.httpStatus === 400 && data.endpoint.includes('/ingest/') && data.endpoint.includes('/actions/test')) {
    name = 'D360_INVALID_DEFINITION';
    actions = [
      'Correct the input to match the ingestion connector object schema and run sf data360 ingest validate again.',
      'Compare the sample payload with the ingestion connector object schema.',
    ];
  } else if (data.httpStatus === 404 || /\bNOT_FOUND\b/u.test(data.message)) {
    name = 'D360_NOT_FOUND';
    actions = ['Confirm the resource name or ID and try again.'];
  }

  if (!data.outcomeUnknown) data.message = localMessage(name);
  // Default structured errors are intentionally minimal. Remote bodies and
  // caller-built URLs can contain arbitrary tenant data and must not be
  // attached to Salesforce CLI's JSON error envelope.
  data.detail = '';
  data.endpoint = '';
  const result = new SfError(data.message, name, actions, exitCode) as SfError<NormalizedError>;
  result.data = data;
  return result;
};
