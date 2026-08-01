import { loadCommandMessages } from '../messages.js';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Global } from '@salesforce/core';

const runtimeMessages = loadCommandMessages('data360.runtime.run.jobCache');

export type JobFamily = 'query' | 'ingest';
export type JobCacheEntry = {
  id: string;
  username: string;
  apiVersion: string;
  startedAt: string;
  context?: Record<string, unknown>;
  outputInfo?: Record<string, unknown>;
};

const TTL: Record<JobFamily, number> = {
  query: 3 * 24 * 60 * 60 * 1000,
  ingest: 7 * 24 * 60 * 60 * 1000,
};
const JOB_CACHE_SCHEMA_VERSION = 1;

type JobCacheEnvelope<T extends JobCacheEntry> = {
  schemaVersion: typeof JOB_CACHE_SCHEMA_VERSION;
  family: JobFamily;
  entries: Record<string, T>;
};

export class JobCache<T extends JobCacheEntry = JobCacheEntry> {
  private entries: Record<string, T> = {};

  private constructor(
    private readonly family: JobFamily,
    private readonly filePath: string,
    private readonly now: () => number
  ) {}

  public static async create<T extends JobCacheEntry = JobCacheEntry>(
    family: JobFamily,
    options: { rootFolder?: string; now?: () => number } = {}
  ): Promise<JobCache<T>> {
    const root = options.rootFolder ?? join(homedir(), Global.SF_STATE_FOLDER);
    const cache = new JobCache<T>(family, join(root, `data360-${family}-jobs.json`), options.now ?? Date.now);
    await cache.read();
    return cache;
  }

  public async save(entry: T): Promise<void> {
    await this.withLock(async () => {
      this.entries = await this.readEntries();
      this.entries[entry.id] = entry;
      this.purgeExpired();
      await this.writeEntries();
    });
  }

  public async get(id: string): Promise<T | undefined> {
    this.entries = await this.readEntries();
    const entry = this.entries[id];
    if (entry && this.now() - Date.parse(entry.startedAt) > TTL[this.family]) {
      await this.withLock(async () => {
        this.entries = await this.readEntries();
        delete this.entries[id];
        await this.writeEntries();
      });
      return undefined;
    }
    return entry;
  }

  public async latest(): Promise<T | undefined> {
    const entries: T[] = [];
    for (const id of Object.keys(this.entries)) {
      const entry = await this.get(id);
      if (entry) entries.push(entry);
    }
    return entries.sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0];
  }

  private async read(): Promise<void> {
    this.entries = await this.readEntries();
  }

  private async readEntries(): Promise<Record<string, T>> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (isJobCacheEnvelope<T>(parsed, this.family)) return parsed.entries;
      if (isLegacyRecord(parsed)) return parsed as Record<string, T>;
      return {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      return {};
    }
  }

  private purgeExpired(): void {
    for (const [id, entry] of Object.entries(this.entries)) {
      if (this.now() - Date.parse(entry.startedAt) > TTL[this.family]) delete this.entries[id];
    }
  }

  private async writeEntries(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    const envelope: JobCacheEnvelope<T> = {
      schemaVersion: JOB_CACHE_SCHEMA_VERSION,
      family: this.family,
      entries: this.entries,
    };
    await writeFile(temporary, `${JSON.stringify(envelope, undefined, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
  }

  private async withLock(action: () => Promise<void>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const lockPath = `${this.filePath}.lock`;
    const started = Date.now();
    for (;;) {
      try {
        const handle = await open(lockPath, 'wx', 0o600);
        try {
          await handle.writeFile(`${process.pid}\n`);
        } finally {
          await handle.close();
        }
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const lock = await stat(lockPath).catch(() => undefined);
        if (lock && Date.now() - lock.mtimeMs > 30_000) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
        if (Date.now() - started > 5_000)
          throw new Error(runtimeMessages.getMessage('error.RUNTIME_0.0', [String(lockPath)]));
        await sleep(20);
      }
    }
    try {
      await action();
    } finally {
      await unlink(lockPath).catch(() => undefined);
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLegacyRecord = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && !Object.hasOwn(value, 'schemaVersion') && isJobEntries(value);

const isJobCacheEnvelope = <T extends JobCacheEntry>(value: unknown, family: JobFamily): value is JobCacheEnvelope<T> =>
  isRecord(value) &&
  value.schemaVersion === JOB_CACHE_SCHEMA_VERSION &&
  value.family === family &&
  isJobEntries(value.entries);

const isJobEntries = <T extends JobCacheEntry>(value: unknown): value is Record<string, T> =>
  isRecord(value) && Object.entries(value).every(([id, entry]) => isJobEntry(entry, id));

const isJobEntry = (value: unknown, key: string): value is JobCacheEntry =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  value.id === key &&
  typeof value.username === 'string' &&
  value.username.length > 0 &&
  typeof value.apiVersion === 'string' &&
  value.apiVersion.length > 0 &&
  typeof value.startedAt === 'string' &&
  Number.isFinite(Date.parse(value.startedAt)) &&
  (value.context === undefined || isRecord(value.context)) &&
  (value.outputInfo === undefined || isRecord(value.outputInfo));
