import { loadCommandMessages } from '../../../messages.js';
import { Flags } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { Data360Command } from '../../../command/Data360Command.js';
import { SsotClient } from '../../../client/ssotClient.js';
import {
  allFlag,
  apiVersionFlag,
  dataSpaceFlag,
  optionalTargetOrgFlag,
  outputFileFlag,
  queryIdFlag,
  queryResultFormatFlag,
  timingFlag,
  useMostRecentFlag,
  workloadNameFlag,
} from '../../../shared/flags.js';
import { resolveQueryContext } from '../../../run/queryContext.js';
import { QueryJobAdapter } from '../../../run/queryJobAdapter.js';
import { DEFAULT_QUERY_ROW_LIMIT, type QueryCommandResult } from '../../../run/types.js';
import { fetchQueryRows, iterateQueryPages } from '../../../ux/queryOutput.js';
import { terminalSafeTable } from '../../../ux/queryResult.js';
import { writeQueryPages, writeQueryResult } from '../../../ux/resultWriter.js';

const commandMessages = loadCommandMessages('data360.query.results');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class QueryResults extends Data360Command<QueryCommandResult> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': optionalTargetOrgFlag,
    'api-version': apiVersionFlag,
    'data-space': dataSpaceFlag,
    'query-id': queryIdFlag,
    'use-most-recent': useMostRecentFlag,
    'workload-name': workloadNameFlag,
    offset: Flags.integer({ default: 0, min: 0, summary: commandMessages.getMessage('flags.offset.summary') }),
    'row-limit': Flags.integer({
      default: DEFAULT_QUERY_ROW_LIMIT,
      min: 1,
      summary: commandMessages.getMessage('flags.row-limit.summary'),
    }),
    all: allFlag,
    'result-format': queryResultFormatFlag,
    'output-file': outputFileFlag,
    'omit-schema': Flags.boolean({ summary: commandMessages.getMessage('flags.omit-schema.summary') }),
    timing: timingFlag,
  };

  public async run(): Promise<QueryCommandResult> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(QueryResults),
      connect: async ({ flags }) =>
        resolveQueryContext({
          queryId: flags['query-id'],
          useMostRecent: flags['use-most-recent'],
          targetOrg: flags['target-org'],
          apiVersion: flags['api-version'],
          dataSpace: flags['data-space'],
        }),
      timingSelected: ({ flags }) => flags.timing,
    });
    const { flags } = initialized.parsed;
    const context = initialized.connection;
    const resultFormat = flags['result-format'] ?? context.entry?.output?.format ?? 'human';
    const outputFile = flags['output-file'] ?? context.entry?.output?.file;
    if (flags['omit-schema'] && !this.jsonEnabled() && resultFormat !== 'json') {
      throw new SfError(commandMessages.getMessage('error.D360_API_ERROR.0'), 'D360_API_ERROR', [
        commandMessages.getMessage('error.D360_API_ERROR.0.actions.1'),
      ]);
    }
    const client = new SsotClient(context.connection, context.apiVersion, initialized.requestTiming);
    const adapter = new QueryJobAdapter(
      client,
      context.dataSpace,
      flags['workload-name'] ?? context.entry?.workloadName
    );
    const pageOptions = {
      offset: flags.offset,
      rowLimit: flags['row-limit'],
      all: flags.all,
      omitSchema: flags['omit-schema'],
    };
    if (flags.all && !this.jsonEnabled()) {
      const rowCount = await writeQueryPages(
        iterateQueryPages(adapter, context.queryId, pageOptions),
        resultFormat,
        outputFile
      );
      return {
        queryId: context.queryId,
        status: 'ResultsProduced',
        done: true,
        rowCount,
      };
    }
    // The global JSON envelope must contain its rows, so that mode necessarily accumulates all requested pages.
    const rows = await fetchQueryRows(adapter, context.queryId, {
      ...pageOptions,
    });
    if (!this.jsonEnabled() && resultFormat === 'human' && !outputFile) {
      const table = terminalSafeTable(rows);
      this.table({ data: table.data, columns: table.columns });
    } else if (!this.jsonEnabled() || outputFile) {
      await writeQueryResult(rows, resultFormat, outputFile);
    }
    return {
      queryId: context.queryId,
      status: 'ResultsProduced',
      done: true,
      rowCount: rows.returnedRows,
      columns: rows.metadata.map(({ name, type }) => ({ name, type })),
      rows: rows.data,
    };
  }
}
