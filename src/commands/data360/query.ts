import { loadCommandMessages } from '../../messages.js';
import { Flags, type Config } from '@oclif/core';
import { SfError } from '@salesforce/core';
import { resolveCommandDataSpace, resolveCreditNotices } from '../../configMeta.js';
import { Data360Command } from '../../command/Data360Command.js';
import { SsotClient } from '../../client/ssotClient.js';
import { formatTiming } from '../../client/request.js';
import {
  apiVersionFlag,
  asyncFlag,
  dataSpaceFlag,
  noPromptFlag,
  outputFileFlag,
  queryFileFlag,
  queryOptionsFileFlag,
  queryWaitFlag,
  resultFormatFlag,
  targetOrgFlag,
  timingFlag,
  workloadNameFlag,
} from '../../shared/flags.js';
import { runQueryJob } from '../../run/jobRunner.js';
import { QueryJobAdapter, mapQueryStatus } from '../../run/queryJobAdapter.js';
import { QueryJobCache } from '../../run/queryJobCache.js';
import { createJobProgress } from '../../run/stages.js';
import {
  resolveQueryInput,
  DEFAULT_QUERY_ROW_LIMIT,
  type QueryCommandResult,
  type QueryRowsResponse,
  type QueryStatusResponse,
} from '../../run/types.js';
import { fetchQueryRows } from '../../ux/queryOutput.js';
import { terminalSafeTable } from '../../ux/queryResult.js';
import { writeQueryResult } from '../../ux/resultWriter.js';
import { runRepl, type ReplFormat } from '../../repl/run.js';
import { MetadataClient } from '../../metadata/client.js';
import { metadataFieldRows, metadataListRows } from '../../metadata/output.js';
import { loadQuerySqlOptions, type QuerySqlOptions } from '../../query/options.js';
import { billableNotice } from '../../shared/billableNotice.js';

const commandMessages = loadCommandMessages('data360.query');

export const shouldEnterRepl = (stdinIsTTY: boolean, stdoutIsTTY: boolean, jsonEnabled: boolean): boolean =>
  stdinIsTTY && stdoutIsTTY && !jsonEnabled;
export const replExecutionOptions = (flags: {
  async?: boolean;
  resultFormat: ReplFormat;
  outputFile?: string;
}): { async: boolean; format: ReplFormat; outputFile?: string } => ({
  async: Boolean(flags.async),
  format: flags.resultFormat,
  outputFile: flags.outputFile,
});

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class Query extends Data360Command<QueryCommandResult> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = {
    'target-org': targetOrgFlag,
    'api-version': apiVersionFlag,
    'data-space': dataSpaceFlag,
    query: Flags.string({ char: 'q', exclusive: ['file'], summary: commandMessages.getMessage('flags.query.summary') }),
    file: queryFileFlag,
    'query-options-file': queryOptionsFileFlag,
    'workload-name': workloadNameFlag,
    'row-limit': Flags.integer({
      default: DEFAULT_QUERY_ROW_LIMIT,
      min: 1,
      summary: commandMessages.getMessage('flags.row-limit.summary'),
    }),
    wait: queryWaitFlag,
    async: asyncFlag,
    'result-format': resultFormatFlag,
    'output-file': outputFileFlag,
    'no-prompt': noPromptFlag,
    timing: timingFlag,
  };

  /**
   * Execute Query as a child command without invoking oclif's top-level JSON
   * serializer. Search wrappers return this result to their own lifecycle,
   * which must emit exactly one JSON document.
   */
  public static async runNested(argv: string[], config: Config): Promise<QueryCommandResult> {
    const command = new Query(argv, config);
    let caught: Error | undefined;
    try {
      await command.init();
      return await command.run();
    } catch (error) {
      caught = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      await command.finally(caught);
    }
  }

  public async run(): Promise<QueryCommandResult> {
    const initialized = await this.initializeTiming({
      parse: async () => this.parse(Query),
      connect: async ({ flags }) => flags['target-org'].getConnection(flags['api-version']),
      timingSelected: ({ flags }) => flags.timing,
    });
    const { flags } = initialized.parsed;
    const dataSpace = await resolveCommandDataSpace({ flagValue: flags['data-space'] });
    const apiVersion = flags['api-version'] ?? initialized.connection.version;
    if (!apiVersion) {
      throw new SfError(commandMessages.getMessage('error.D360_API_ERROR.0'), 'D360_API_ERROR', [
        commandMessages.getMessage('error.D360_API_ERROR.0.actions.1'),
      ]);
    }
    if (!flags.wait) {
      throw new SfError(commandMessages.getMessage('error.D360_API_ERROR.1'), 'D360_API_ERROR', [
        commandMessages.getMessage('error.D360_API_ERROR.1.actions.1'),
      ]);
    }
    const client = new SsotClient(initialized.connection, apiVersion, initialized.requestTiming);
    const queryOptions = flags['query-options-file'] ? await loadQuerySqlOptions(flags['query-options-file']) : {};
    const username = flags['target-org'].getUsername();
    if (!username) {
      throw new SfError(commandMessages.getMessage('error.D360_AUTH_EXPIRED.2'), 'D360_AUTH_EXPIRED', [
        commandMessages.getMessage('error.D360_AUTH_EXPIRED.2.actions.1'),
      ]);
    }
    if (
      !flags.query &&
      !flags.file &&
      shouldEnterRepl(Boolean(process.stdin.isTTY), Boolean(process.stdout.isTTY), this.jsonEnabled())
    ) {
      const metadata = new MetadataClient(client);
      const replOptions = replExecutionOptions({
        async: flags.async,
        resultFormat: flags['result-format'],
        outputFile: flags['output-file'],
      });
      const exitCode = await runRepl({
        dataSpace,
        initialFormat: replOptions.format,
        initialOutputFile: replOptions.outputFile,
        initialTiming: Boolean(flags.timing),
        execute: async (sql, context) => {
          const replClient = new SsotClient(initialized.connection, apiVersion, {
            ...initialized.requestTiming,
            onTiming: context.timing ? (timing): void => this.logToStderr(formatTiming(timing)) : undefined,
          });
          const result = await this.executeSql(sql, replClient, context.dataSpace, username, apiVersion, {
            rowLimit: flags['row-limit'],
            waitMs: flags.wait!.milliseconds,
            async: replOptions.async,
            format: context.format,
            outputFile: context.outputFile,
            expanded: context.expanded,
            workloadName: flags['workload-name'],
            queryOptions,
            noPrompt: Boolean(flags['no-prompt']),
          });
          return result.queryId;
        },
        listTables: async (entityType, currentDataSpace) => {
          const entities = await metadata.list({
            dataSpace: currentDataSpace,
            entityType: this.replEntityType(entityType),
            limit: 100,
            all: false,
          });
          this.table({
            data: metadataListRows(entities),
            columns: ['name', 'displayName', 'entityCategory', 'entityType', 'fields#'],
          });
        },
        describe: async (entityName, currentDataSpace) => {
          const entity = await metadata.get(entityName, currentDataSpace);
          this.table({
            data: metadataFieldRows(entity),
            columns: ['name', 'type', 'businessType', 'primaryKey?'],
          });
        },
      });
      if (exitCode !== 0) process.exitCode = exitCode;
      return { queryId: '', status: 'Exited', done: true };
    }
    const sql = await resolveQueryInput({
      query: flags.query,
      file: flags.file,
      stdin: process.stdin,
      stdinIsTTY: process.stdin.isTTY,
    });
    return this.executeSql(sql, client, dataSpace, username, apiVersion, {
      rowLimit: flags['row-limit'],
      waitMs: flags.wait.milliseconds,
      async: Boolean(flags.async),
      format: flags['result-format'],
      outputFile: flags['output-file'],
      workloadName: flags['workload-name'],
      queryOptions,
      noPrompt: Boolean(flags['no-prompt']),
    });
  }

  private async executeSql(
    sql: string,
    client: SsotClient,
    dataSpace: string,
    username: string,
    apiVersion: string,
    options: {
      rowLimit: number;
      waitMs: number;
      async: boolean;
      format: ReplFormat;
      outputFile?: string;
      expanded?: boolean;
      workloadName?: string;
      queryOptions: QuerySqlOptions;
      noPrompt: boolean;
    }
  ): Promise<QueryCommandResult> {
    if (!this.jsonEnabled() && (await resolveCreditNotices())) this.status(billableNotice('Data 360 Query'));
    await this.confirmDestructive(options.noPrompt, commandMessages.getMessage('runtime.confirmBillable'));
    const adapter = new QueryJobAdapter(client, dataSpace, options.workloadName);
    const submitted = await adapter.submit(sql, options.rowLimit, options.queryOptions);
    const queryId = submitted.status.queryId;
    const submittedState = mapQueryStatus(submitted.status.completionStatus);

    // Only pending queries are resumable. Data 360 can finish even an --async
    // submission inline; caching that terminal ID produces a misleading -r hint
    // and can race a later query after the short-lived status record disappears.
    if (!submittedState.terminal) {
      const cache = await QueryJobCache.create();
      await cache.save({
        id: queryId,
        username,
        apiVersion,
        dataSpace,
        workloadName: options.workloadName,
        submittedAt: new Date().toISOString(),
        output: { format: options.format, file: options.outputFile },
      });
    }

    const asyncMode = options.async || options.waitMs === 0;
    if (asyncMode && !submittedState.terminal) {
      if (!this.jsonEnabled()) {
        this.status(commandMessages.getMessage('runtime.status.3'));
        this.status(commandMessages.getMessage('runtime.status.4', [String(queryId)]));
      }
      return this.result(submitted.status);
    }

    let rows: QueryRowsResponse;
    let finalStatus: QueryStatusResponse = submitted.status;
    if (submittedState.successful && Array.isArray(submitted.data) && Array.isArray(submitted.metadata)) {
      rows = {
        data: submitted.data,
        metadata: submitted.metadata,
        returnedRows: submitted.returnedRows ?? submitted.data.length,
      };
    } else {
      if (!submittedState.successful) {
        const progress = createJobProgress({
          title: 'Data 360 query',
          stages: ['Submitted', 'Running', 'Fetching rows'],
          jsonEnabled: this.jsonEnabled(),
          isTTY: Boolean(process.stderr.isTTY),
          ci: process.env.CI !== undefined,
        });
        progress.goto('Submitted');
        let progressError: Error | undefined;
        try {
          finalStatus = await runQueryJob(adapter, queryId, {
            timeoutMs: options.waitMs,
            onStatus: () => progress.goto('Running'),
          });
          progress.goto('Fetching rows');
        } catch (error) {
          progressError = error as Error;
          throw error;
        } finally {
          progress.stop(progressError);
        }
      }
      rows = await fetchQueryRows(adapter, queryId, { offset: 0, rowLimit: options.rowLimit, all: false });
    }
    if (!this.jsonEnabled() && options.format === 'human' && !options.outputFile) {
      const table = terminalSafeTable(rows);
      if (options.expanded) {
        for (const row of table.data) {
          this.table({
            data: table.columns.map((column) => ({ column, value: row[column] })),
            columns: ['column', 'value'],
          });
        }
      } else {
        this.table({ data: table.data, columns: table.columns });
      }
    } else if (!this.jsonEnabled() || options.outputFile) {
      await writeQueryResult(rows, options.format, options.outputFile);
    }
    return this.result(finalStatus, rows);
  }

  private replEntityType(value?: string): string | undefined {
    if (!value) return undefined;
    const types: Record<string, string> = {
      dlo: 'DataLakeObject',
      dmo: 'DataModelObject',
      ci: 'CalculatedInsight',
    };
    const type = types[value.toLowerCase()];
    if (!type)
      throw new SfError(commandMessages.getMessage('error.D360_API_ERROR.5', [String(value)]), 'D360_API_ERROR', [
        commandMessages.getMessage('error.D360_API_ERROR.5.actions.1'),
      ]);
    return type;
  }

  private result(
    status: { queryId: string; completionStatus: string; rowCount?: number },
    rows?: QueryRowsResponse
  ): QueryCommandResult {
    return {
      queryId: status.queryId,
      status: status.completionStatus,
      done: mapQueryStatus(status.completionStatus).successful,
      rowCount: status.rowCount,
      columns: rows?.metadata.map(({ name, type }) => ({ name, type })),
      rows: rows?.data,
    };
  }
}
