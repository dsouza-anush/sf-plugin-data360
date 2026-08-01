import { access } from 'node:fs/promises';
import { Flags as OclifFlags } from '@oclif/core';
import { Flags as SfFlags } from '@salesforce/sf-plugins-core';
import { loadCommandMessages } from '../messages.js';

const messages = loadCommandMessages('data360.common');

export const targetOrgFlag = SfFlags.requiredOrg({
  char: 'o',
  summary: messages.getMessage('flags.target-org.summary'),
});

export const optionalTargetOrgFlag = SfFlags.optionalOrg({
  char: 'o',
  summary: messages.getMessage('flags.target-org.summary'),
});

export const apiVersionFlag = SfFlags.orgApiVersion();

export const dataSpaceFlag = OclifFlags.string({
  summary: messages.getMessage('flags.data-space.summary'),
});

export const waitFlag = SfFlags.duration({
  char: 'w',
  unit: 'minutes',
  summary: messages.getMessage('flags.wait.summary'),
});

export const asyncFlag = OclifFlags.boolean({
  exclusive: ['wait'],
  summary: messages.getMessage('flags.async.summary'),
});

export const jobIdFlag = OclifFlags.string({
  char: 'i',
  summary: messages.getMessage('flags.job-id.summary'),
});

export const queryIdFlag = OclifFlags.string({
  char: 'i',
  exactlyOne: ['query-id', 'use-most-recent'],
  summary: messages.getMessage('flags.query-id.summary'),
});

export const useMostRecentFlag = OclifFlags.boolean({
  char: 'r',
  summary: messages.getMessage('flags.use-most-recent.summary'),
});

export const nameFlag = OclifFlags.string({
  char: 'n',
  summary: messages.getMessage('flags.name.summary'),
});

export const fileFlag = OclifFlags.string({
  char: 'f',
  summary: messages.getMessage('flags.file.summary'),
  parse: async (value) => {
    if (value !== '-') await access(value);
    return value;
  },
});

export const queryFileFlag = OclifFlags.string({
  char: 'f',
  exclusive: ['query'],
  summary: messages.getMessage('flags.query-file.summary'),
  parse: async (value) => {
    if (value !== '-') await access(value);
    return value;
  },
});

export const queryOptionsFileFlag = OclifFlags.string({
  summary: messages.getMessage('flags.query-options-file.summary'),
  parse: async (value) => {
    await access(value);
    return value;
  },
});

export const workloadNameFlag = OclifFlags.string({
  summary: messages.getMessage('flags.workload-name.summary'),
});

export const queryWaitFlag = SfFlags.duration({
  char: 'w',
  unit: 'minutes',
  defaultValue: 5,
  min: 0,
  summary: messages.getMessage('flags.query-wait.summary'),
});

export const resultFormatFlag = OclifFlags.option({
  options: ['human', 'csv', 'json'] as const,
  default: 'human' as const,
  exclusive: ['json'],
  summary: messages.getMessage('flags.result-format.summary'),
})();

export const queryResultFormatFlag = OclifFlags.option({
  options: ['human', 'csv', 'json'] as const,
  exclusive: ['json'],
  summary: messages.getMessage('flags.result-format.summary'),
})();

export const timingFlag = OclifFlags.boolean({
  helpGroup: 'GLOBAL',
  summary: messages.getMessage('flags.timing.summary'),
});

export const outputFileFlag = OclifFlags.string({
  summary: messages.getMessage('flags.output-file.summary'),
});

export const noPromptFlag = OclifFlags.boolean({
  summary: messages.getMessage('flags.no-prompt.summary'),
});

export const sourceNameFlag = OclifFlags.string({
  char: 's',
  required: true,
  summary: messages.getMessage('flags.source-name.summary'),
});

export const objectNameFlag = OclifFlags.string({
  required: true,
  summary: messages.getMessage('flags.object-name.summary'),
});

export const ingestWaitFlag = SfFlags.duration({
  char: 'w',
  unit: 'minutes',
  defaultValue: 10,
  min: 0,
  summary: messages.getMessage('flags.ingest-wait.summary'),
});

export const noTokenCacheFlag = OclifFlags.boolean({
  summary: messages.getMessage('flags.no-token-cache.summary'),
});

export const allFlag = OclifFlags.boolean({
  summary: messages.getMessage('flags.all.summary'),
});

export const limitFlag = OclifFlags.integer({
  default: 100,
  min: 1,
  summary: messages.getMessage('flags.limit.summary'),
});

export const targetOrg = (required = true): typeof targetOrgFlag | typeof optionalTargetOrgFlag =>
  required ? targetOrgFlag : optionalTargetOrgFlag;
