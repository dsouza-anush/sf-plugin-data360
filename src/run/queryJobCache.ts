import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Global } from '@salesforce/core';
import type { QueryJobCacheEntry } from './types.js';

const QUERY_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const QUERY_CACHE_SCHEMA_VERSION = 1;

type QueryJobCacheEnvelope = {
  schemaVersion: typeof QUERY_CACHE_SCHEMA_VERSION;
  entries: Record<string, QueryJobCacheEntry>;
};

export type QueryJobCacheOptions = {
  rootFolder?: string;
  now?: () => number;
  environment?: NodeJS.ProcessEnv;
};

export class QueryJobCache {
  private entries: Record<string, QueryJobCacheEntry> = {};

  private constructor(
    private readonly filePath: string,
    private readonly now: () => number
  ) {}

  public static async create(options: QueryJobCacheOptions = {}): Promise<QueryJobCache> {
    // TTLConfig timestamps on write, which prevents deterministic submitted-at ordering and expiry tests.
    // This store keeps the same state-folder and TTL semantics while allowing the clock to be injected.
    const root =
      options.rootFolder ??
      options.environment?.SF_DATA360_QUERY_CACHE_DIR ??
      process.env.SF_DATA360_QUERY_CACHE_DIR ??
      join(homedir(), Global.SF_STATE_FOLDER);
    const cache = new QueryJobCache(join(root, 'data360-query-jobs.json'), options.now ?? Date.now);
    await cache.read();
    return cache;
  }

  public async save(entry: QueryJobCacheEntry): Promise<void> {
    this.entries[entry.id] = entry;
    await this.write();
  }

  public async get(id: string): Promise<QueryJobCacheEntry | undefined> {
    const entry = this.entries[id];
    if (entry && this.expired(entry)) {
      delete this.entries[id];
      await this.write();
      return undefined;
    }
    return entry;
  }

  public async latest(username?: string): Promise<QueryJobCacheEntry | undefined> {
    const entries = await Promise.all(Object.keys(this.entries).map(async (id) => this.get(id)));
    return entries
      .filter(
        (entry): entry is QueryJobCacheEntry =>
          entry !== undefined && (username === undefined || entry.username === username)
      )
      .reduce<QueryJobCacheEntry | undefined>((latest, entry) => {
        if (!latest || Date.parse(entry.submittedAt) >= Date.parse(latest.submittedAt)) return entry;
        return latest;
      }, undefined);
  }

  private expired(entry: QueryJobCacheEntry): boolean {
    return this.now() - Date.parse(entry.submittedAt) > QUERY_CACHE_TTL_MS;
  }

  private async read(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (isQueryJobCacheEnvelope(parsed)) {
        this.entries = parsed.entries;
      } else if (isLegacyRecord(parsed)) {
        // Migrate the original unversioned id-to-entry map on the next write.
        this.entries = parsed as Record<string, QueryJobCacheEntry>;
      } else {
        this.entries = {};
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      this.entries = {};
    }
  }

  private async write(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    const envelope: QueryJobCacheEnvelope = {
      schemaVersion: QUERY_CACHE_SCHEMA_VERSION,
      entries: this.entries,
    };
    await writeFile(temporary, `${JSON.stringify(envelope, undefined, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLegacyRecord = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && !Object.hasOwn(value, 'schemaVersion') && isQueryJobEntries(value);

const isQueryJobCacheEnvelope = (value: unknown): value is QueryJobCacheEnvelope =>
  isRecord(value) && value.schemaVersion === QUERY_CACHE_SCHEMA_VERSION && isQueryJobEntries(value.entries);

const isQueryJobEntries = (value: unknown): value is Record<string, QueryJobCacheEntry> =>
  isRecord(value) && Object.entries(value).every(([id, entry]) => isQueryJobEntry(entry, id));

const isQueryJobEntry = (value: unknown, key: string): value is QueryJobCacheEntry => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id !== key ||
    typeof value.username !== 'string' ||
    value.username.length === 0 ||
    typeof value.apiVersion !== 'string' ||
    value.apiVersion.length === 0 ||
    typeof value.dataSpace !== 'string' ||
    value.dataSpace.length === 0 ||
    typeof value.submittedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.submittedAt)) ||
    (value.workloadName !== undefined && typeof value.workloadName !== 'string')
  )
    return false;
  if (value.output === undefined) return true;
  return (
    isRecord(value.output) &&
    typeof value.output.format === 'string' &&
    ['csv', 'human', 'json'].includes(value.output.format) &&
    (value.output.file === undefined || typeof value.output.file === 'string')
  );
};
