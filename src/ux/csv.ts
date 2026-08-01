import type { QueryMetadata } from '../run/types.js';
import { orderedColumns } from './queryResult.js';

export const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  let firstVisible = 0;
  while (firstVisible < raw.length && raw.charCodeAt(firstVisible) <= 0x20) firstVisible += 1;
  const prefix = raw[firstVisible];
  const text = typeof value === 'string' && prefix && '=+-@'.includes(prefix) ? `'${raw}` : raw;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const toCsv = (metadata: QueryMetadata[], rows: unknown[][]): string => {
  const columns = orderedColumns(metadata);
  const values = [
    columns.map(({ column }) => column.name),
    ...rows.map((row) => columns.map(({ index }) => row[index])),
  ];
  return `${values.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
};
