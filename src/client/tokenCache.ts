import { ConfigFile, Global, type Connection } from '@salesforce/core';
import { chmod } from 'node:fs/promises';
import { exchangeConnection, validateTenantUrl, type DirectToken } from './tokenExchange.js';

export type TokenStorage = {
  read: () => Promise<string | undefined>;
  write: (contents: string) => Promise<void>;
  close?: () => Promise<void>;
};

export type TokenCipher = {
  encrypt: (value: string) => string;
  decrypt: (value: string) => string;
  close?: () => void;
};

export type TokenCacheOptions = {
  storage?: TokenStorage;
  cipher?: TokenCipher;
  now?: () => number;
  exchange?: (connection: Connection) => Promise<DirectToken>;
  bypass?: boolean;
  rootFolder?: string;
  env?: Readonly<Record<string, string | undefined>>;
};

const CACHE_FILE = 'data360-token-cache.json';
const EXPIRY_SKEW_MS = 5 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 1;

type TokenCacheEnvelope = {
  schemaVersion: typeof CACHE_SCHEMA_VERSION;
  entries: Record<string, DirectToken>;
};

class CoreTokenConfig extends ConfigFile {
  protected static encryptedKeys = ['cache'];

  public async close(): Promise<void> {
    await this.clearCrypto();
  }
}

const coreStorage = async (rootFolder?: string): Promise<TokenStorage> => {
  const config = await CoreTokenConfig.create({
    ...(rootFolder
      ? { rootFolder, filename: CACHE_FILE }
      : { isGlobal: true, isState: true, stateFolder: Global.SF_STATE_FOLDER, filename: CACHE_FILE }),
  });
  return {
    read: async (): Promise<string | undefined> => {
      const value = config.get('cache', true);
      return typeof value === 'string' ? value : undefined;
    },
    write: async (contents): Promise<void> => {
      config.set('cache', contents);
      await config.write();
      await chmod(config.getPath(), 0o600);
    },
    close: async (): Promise<void> => config.close(),
  };
};

const identityCipher: TokenCipher = {
  encrypt: (value) => value,
  decrypt: (value) => value,
};

export class TokenCache {
  private entries: Record<string, DirectToken> = {};

  private constructor(
    private readonly storage: TokenStorage,
    private readonly cipher: TokenCipher,
    private readonly now: () => number,
    private readonly exchangeToken: (connection: Connection) => Promise<DirectToken>,
    private readonly bypass: boolean,
    private readonly env: Readonly<Record<string, string | undefined>>
  ) {}

  public static async create(options: TokenCacheOptions = {}): Promise<TokenCache> {
    const cipher = options.cipher ?? identityCipher;
    const storage =
      options.storage ??
      (options.bypass
        ? {
            read: async (): Promise<undefined> => undefined,
            write: async (): Promise<void> => {},
          }
        : await coreStorage(options.rootFolder));
    const cache = new TokenCache(
      storage,
      cipher,
      options.now ?? Date.now,
      options.exchange ?? exchangeConnection,
      Boolean(options.bypass),
      options.env ?? process.env
    );
    if (!cache.bypass) await cache.read();
    return cache;
  }

  public async get(
    username: string,
    connection: Connection,
    options: { useCache?: boolean } = {}
  ): Promise<DirectToken> {
    const usePersistentCache = !this.bypass && options.useCache !== false;
    if (usePersistentCache) {
      const cached = this.entries[username];
      if (cached && this.now() < Date.parse(cached.expiresAt) - EXPIRY_SKEW_MS) {
        return { ...cached, instanceUrl: validateTenantUrl(cached.instanceUrl, this.env) };
      }
    }
    const token = await this.exchangeToken(connection);
    const validated = { ...token, instanceUrl: validateTenantUrl(token.instanceUrl, this.env) };
    if (usePersistentCache) {
      this.entries[username] = validated;
      await this.write();
    }
    return validated;
  }

  public async invalidate(username: string): Promise<void> {
    if (this.bypass) return;
    if (this.entries[username]) {
      delete this.entries[username];
      await this.write();
    }
  }

  public async close(): Promise<void> {
    this.cipher.close?.();
    await this.storage.close?.();
  }

  private async read(): Promise<void> {
    const encrypted = await this.storage.read();
    if (!encrypted?.trim()) return;
    try {
      const parsed = JSON.parse(this.cipher.decrypt(encrypted.trim())) as unknown;
      if (isTokenCacheEnvelope(parsed)) {
        this.entries = parsed.entries;
      } else if (isLegacyRecord(parsed)) {
        // Migrate caches written before schemaVersion was introduced.
        this.entries = parsed as Record<string, DirectToken>;
      } else {
        this.entries = {};
      }
    } catch {
      // A damaged or no-longer-decryptable cache is disposable. The next get()
      // safely exchanges a fresh token and rewrites the file.
      this.entries = {};
    }
  }

  private async write(): Promise<void> {
    const envelope: TokenCacheEnvelope = { schemaVersion: CACHE_SCHEMA_VERSION, entries: this.entries };
    await this.storage.write(`${this.cipher.encrypt(JSON.stringify(envelope))}\n`);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLegacyRecord = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && !Object.hasOwn(value, 'schemaVersion') && isTokenEntries(value);

const isTokenCacheEnvelope = (value: unknown): value is TokenCacheEnvelope =>
  isRecord(value) && value.schemaVersion === CACHE_SCHEMA_VERSION && isTokenEntries(value.entries);

const isTokenEntries = (value: unknown): value is Record<string, DirectToken> =>
  isRecord(value) &&
  Object.entries(value).every(
    ([username, entry]) =>
      username.length > 0 &&
      isRecord(entry) &&
      typeof entry.jwt === 'string' &&
      entry.jwt.length > 0 &&
      typeof entry.instanceUrl === 'string' &&
      entry.instanceUrl.length > 0 &&
      typeof entry.expiresAt === 'string' &&
      Number.isFinite(Date.parse(entry.expiresAt)) &&
      (entry.scopes === undefined ||
        (Array.isArray(entry.scopes) && entry.scopes.every((scope) => typeof scope === 'string')))
  );
