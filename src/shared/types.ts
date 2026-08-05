export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ResultFormat = 'human' | 'csv' | 'json';

export type Timing = {
  parseMs: number;
  connectionMs: number;
  requestMs: number;
  totalMs: number;
};
