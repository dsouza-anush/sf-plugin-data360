import { Flags, type Config } from '@oclif/core';
import { loadCommandMessages } from '../messages.js';
import Query from '../commands/data360/query.js';
import {
  apiVersionFlag,
  asyncFlag,
  dataSpaceFlag,
  noPromptFlag,
  outputFileFlag,
  queryWaitFlag,
  resultFormatFlag,
  targetOrgFlag,
  timingFlag,
} from '../shared/flags.js';
import type { QueryCommandResult } from '../run/types.js';

const messages = loadCommandMessages('data360.common');

export const searchQueryFlags = {
  'target-org': targetOrgFlag,
  'api-version': apiVersionFlag,
  'data-space': dataSpaceFlag,
  index: Flags.string({ required: true, summary: messages.getMessage('flags.index.summary') }),
  text: Flags.string({ char: 't', required: true, summary: messages.getMessage('flags.text.summary') }),
  'top-k': Flags.integer({ default: 5, min: 1, summary: messages.getMessage('flags.top-k.summary') }),
  filter: Flags.string({ summary: messages.getMessage('flags.filter.summary') }),
  select: Flags.string({ summary: messages.getMessage('flags.select.summary') }),
  wait: queryWaitFlag,
  async: asyncFlag,
  'result-format': resultFormatFlag,
  'output-file': outputFileFlag,
  'no-prompt': noPromptFlag,
  timing: timingFlag,
};

type SearchFlags = {
  'target-org': { getUsername: () => string | undefined };
  'api-version'?: string;
  'data-space'?: string;
  wait: { milliseconds: number };
  async?: boolean;
  'result-format': string;
  'output-file'?: string;
  timing?: boolean;
  'no-prompt'?: boolean;
  'top-k': number;
};

export const executeSearchQuery = async (
  flags: SearchFlags,
  sql: string,
  jsonEnabled: boolean,
  config: Config
): Promise<QueryCommandResult> => {
  const username = flags['target-org'].getUsername();
  const argv = [
    '--target-org',
    username!,
    '--query',
    sql,
    '--row-limit',
    String(flags['top-k']),
    '--wait',
    String(flags.wait.milliseconds / 60_000),
  ];
  if (flags['api-version']) argv.push('--api-version', flags['api-version']);
  if (flags['data-space']) argv.push('--data-space', flags['data-space']);
  if (flags.async) argv.push('--async');
  if (flags['output-file']) argv.push('--output-file', flags['output-file']);
  if (flags.timing) argv.push('--timing');
  if (flags['no-prompt']) argv.push('--no-prompt');
  if (jsonEnabled) argv.push('--json');
  else argv.push('--result-format', flags['result-format']);
  return Query.runNested(argv, config);
};
