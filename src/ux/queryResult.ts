import type { QueryMetadata, QueryRowsResponse } from '../run/types.js';
import { terminalSafeText } from './terminal.js';

export const orderedColumns = (metadata: QueryMetadata[]): Array<{ column: QueryMetadata; index: number }> =>
  metadata
    .map((column, index) => ({ column, index }))
    .sort((left, right) => (left.column.placeInOrder ?? left.index) - (right.column.placeInOrder ?? right.index));

export const orderedRows = (response: QueryRowsResponse): Array<Record<string, unknown>> => {
  const columns = orderedColumns(response.metadata);
  return response.data.map((values) =>
    Object.fromEntries(columns.map(({ column, index }) => [column.name, values[index] ?? null]))
  );
};

export const terminalSafeCell = terminalSafeText;

export const terminalSafeTable = (
  response: QueryRowsResponse
): { columns: string[]; data: Array<Record<string, string>> } => {
  const ordered = orderedColumns(response.metadata);
  const columns = ordered.map(({ column }) => terminalSafeText(column.name));
  const data = response.data.map((values) =>
    Object.fromEntries(
      ordered.map(({ index }, position) => [columns[position], terminalSafeText(values[index] ?? null)])
    )
  );
  return { columns, data };
};

export const humanResult = (response: QueryRowsResponse): string => {
  const columns = orderedColumns(response.metadata);
  const header = columns.map(({ column }) => terminalSafeCell(column.name)).join('\t');
  const rows = response.data.map((row) =>
    columns
      .map(({ index }) => row[index])
      .map(terminalSafeCell)
      .join('\t')
  );
  return `${[header, ...rows].join('\n')}\n`;
};
