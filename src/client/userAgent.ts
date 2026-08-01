import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageVersion = (require('../../package.json') as { version?: unknown }).version;

export const getUserAgent = (
  version: string = typeof packageVersion === 'string' ? packageVersion : 'unknown'
): string => `sf-plugin-data360/${version}`;
