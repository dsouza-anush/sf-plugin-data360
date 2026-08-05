// SQL builder structure adapted from Jaganpro/sf-cli-plugin-data360 (MIT).
export const quoteIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;
const quoteString = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export const normalizeIndexTables = (index: string): { indexTable: string; chunkTable: string } => {
  const base = index.endsWith('_index__dlm') ? index.slice(0, -'_index__dlm'.length) : index;
  return { indexTable: `${base}_index__dlm`, chunkTable: `${base}_chunk__dlm` };
};

const selection = (value: string | undefined, scoreColumns: readonly string[]): string => {
  const requested = value
    ?.split(',')
    .map((field) => field.trim())
    .filter(Boolean);
  const fields = requested?.length ? requested.map((field) => `c.${quoteIdentifier(field)}`) : ['c."Chunk__c"'];
  return [...fields, ...scoreColumns.map((field) => `v.${quoteIdentifier(field)}`), 'v."SourceRecordId__c"'].join(', ');
};

export const buildVectorSearchSql = (options: {
  index: string;
  text: string;
  topK: number;
  filter?: string;
  select?: string;
}): string => {
  const { indexTable, chunkTable } = normalizeIndexTables(options.index);
  return [
    `SELECT ${selection(options.select, ['score__c'])}`,
    `FROM vector_search(TABLE(${quoteIdentifier(indexTable)}), ${quoteString(options.text)}, ${quoteString(options.filter ?? '')}, ${options.topK}) AS v`,
    `JOIN ${quoteIdentifier(chunkTable)} AS c ON v."SourceRecordId__c" = c."RecordId__c"`,
    'ORDER BY v."score__c" DESC',
    `LIMIT ${options.topK}`,
  ].join(' ');
};

export const buildHybridSearchSql = (options: {
  index: string;
  text: string;
  topK: number;
  filter?: string;
  select?: string;
}): string => {
  const { indexTable, chunkTable } = normalizeIndexTables(options.index);
  return [
    `SELECT ${selection(options.select, ['hybrid_score__c', 'keyword_score__c', 'vector_score__c'])}`,
    `FROM hybrid_search(TABLE(${quoteIdentifier(indexTable)}), ${quoteString(options.text)}, ${quoteString(options.filter ?? '')}, ${options.topK}) AS v`,
    `JOIN ${quoteIdentifier(chunkTable)} AS c ON v."SourceRecordId__c" = c."RecordId__c"`,
    'ORDER BY v."hybrid_score__c" DESC',
    `LIMIT ${options.topK}`,
  ].join(' ');
};
