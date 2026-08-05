import { loadCommandMessages } from '../../../messages.js';
import { Data360Command } from '../../../command/Data360Command.js';
import { executeSearchQuery, searchQueryFlags } from '../../../query/searchCommand.js';
import { buildVectorSearchSql } from '../../../query/searchSql.js';
import type { QueryCommandResult } from '../../../run/types.js';

const commandMessages = loadCommandMessages('data360.query.vector');

// eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.
export default class QueryVector extends Data360Command<QueryCommandResult> {
  public static readonly summary = commandMessages.getMessage('summary');
  public static readonly description = commandMessages.getMessage('description');
  public static readonly examples = commandMessages.getMessages('examples');
  public static readonly enableJsonFlag = true;
  public static readonly flags = searchQueryFlags;
  public async run(): Promise<QueryCommandResult> {
    const { flags } = await this.parse(QueryVector);
    const sql = buildVectorSearchSql({
      index: flags.index,
      text: flags.text,
      topK: flags['top-k'],
      filter: flags.filter,
      select: flags.select,
    });
    return executeSearchQuery(flags, sql, this.jsonEnabled(), this.config);
  }
}
