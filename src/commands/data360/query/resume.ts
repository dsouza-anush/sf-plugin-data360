import { loadCommandMessages } from '../../../messages.js';
import { Data360Command } from '../../../command/Data360Command.js';
import { SsotClient } from '../../../client/ssotClient.js';
import {
  apiVersionFlag,
  dataSpaceFlag,
  optionalTargetOrgFlag,
  outputFileFlag,
  queryIdFlag,
  queryResultFormatFlag,
  queryWaitFlag,
  timingFlag,
  useMostRecentFlag,
  workloadNameFlag,
} from '../../../shared/flags.js';
import { runQueryJob } from '../../../run/jobRunner.js';
import { resolveQueryContext } from '../../../run/queryContext.js';
import { QueryJobAdapter } from '../../../run/queryJobAdapter.js';
import { createJobProgress } from '../../../run/stages.js';
import {
  DEFAULT_QUERY_ROW_LIMIT,
  type QueryCommandResult,
  type QueryRowsResponse,
  type QueryStatusResponse,
} from '../../../run/types.js';
import { fetchQueryRows } from '../../../ux/queryOutput.js';
import { terminalSafeTable } from '../../../ux/queryResult.js';
import { writeQueryResult } from '../../../ux/resultWriter.js';

const commandMessages = loadCommandMessages('data360.query.resume');

const isNotFoundStatus = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'D360_NOT_FOUND';

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class QueryResume extends Data360Command<QueryCommandResult> {
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
    wait: queryWaitFlag,
    'result-format': queryResultFormatFlag,
    'output-file': outputFileFlag,
    timing: timingFlag,
  };

  public async run(): Promise<QueryCommandResult> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(QueryResume),
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
    const client = new SsotClient(context.connection, context.apiVersion, initialized.requestTiming);
    const adapter = new QueryJobAdapter(
      client,
      context.dataSpace,
      flags['workload-name'] ?? context.entry?.workloadName
    );
    const progress = createJobProgress({
      title: 'Data 360 query',
      stages: ['Submitted', 'Running', 'Fetching rows'],
      jsonEnabled: this.jsonEnabled(),
      isTTY: Boolean(process.stderr.isTTY),
      ci: process.env.CI !== undefined,
    });
    let status: QueryStatusResponse;
    let retainedRows: QueryRowsResponse | undefined;
    let progressError: Error | undefined;
    try {
      status = await runQueryJob(adapter, context.queryId, {
        timeoutMs: flags.wait.milliseconds,
        onStatus: () => progress.goto('Running'),
      });
      progress.goto('Fetching rows');
    } catch (error) {
      if (isNotFoundStatus(error)) {
        try {
          retainedRows = await fetchQueryRows(adapter, context.queryId, {
            offset: 0,
            rowLimit: DEFAULT_QUERY_ROW_LIMIT,
            all: false,
          });
        } catch {
          // The status endpoint is authoritative when neither endpoint retains
          // the query. Preserve its normalized code, data, and actions rather
          // than replacing it with the rows endpoint's secondary failure.
          progressError = error as Error;
          throw error;
        }
        status = {
          completionStatus: 'ResultsProduced',
          queryId: context.queryId,
          rowCount: retainedRows.returnedRows,
        };
        progress.goto('Fetching rows');
      } else {
        progressError = error as Error;
        throw error;
      }
    } finally {
      progress.stop(progressError);
    }
    const rows =
      retainedRows ??
      (await fetchQueryRows(adapter, context.queryId, {
        offset: 0,
        rowLimit: DEFAULT_QUERY_ROW_LIMIT,
        all: false,
      }));
    if (!this.jsonEnabled() && resultFormat === 'human' && !outputFile) {
      const table = terminalSafeTable(rows);
      this.table({ data: table.data, columns: table.columns });
    } else if (!this.jsonEnabled() || outputFile) {
      await writeQueryResult(rows, resultFormat, outputFile);
    }
    return {
      queryId: context.queryId,
      status: status.completionStatus,
      done: true,
      rowCount: status.rowCount,
      columns: rows.metadata.map(({ name, type }) => ({ name, type })),
      rows: rows.data,
    };
  }
}
