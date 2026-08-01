import { constants } from 'node:fs';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

type TraceEnvironment = Readonly<Record<string, string | undefined>>;
type TraceEvent = Readonly<Record<string, unknown>>;

const TRACE_ID = /^[A-Za-z\d][A-Za-z\d._:-]{7,127}$/u;
const SECRET_KEY =
  /^(?:authorization|bearer|client.?secret|consumer.?key|cookie|set.?cookie|password|private.?key|refresh.?token|secret|session|sid|subject.?token|access.?token|api.?key|jwt|.*token.*)$/iu;
const BEARER = /\bBearer\s+[A-Za-z\d._~+/=-]+/giu;
const JWT = /\beyJ[A-Za-z\d_-]+\.[A-Za-z\d_-]+\.[A-Za-z\d_-]+\b/gu;
const SALESFORCE_TOKEN = /(?<![A-Za-z\d])00D[A-Za-z\d]{12,15}(?:!|%21)[A-Za-z\d._~+%/=-]{8,}(?![A-Za-z\d._~+%/=-])/gu;
const ORG_ID = /\b00D[A-Za-z\d]{12,15}\b/gu;
const SALESFORCE_ID_CANDIDATE = /(?<![A-Za-z\d])(?:[A-Za-z\d]{15}|[A-Za-z\d]{18})(?![A-Za-z\d])/gu;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const EMAIL = /\b[A-Z\d._%+-]+@[A-Z\d.-]+\.[A-Z]{2,}\b/giu;
const SALESFORCE_HOST = /\b(?:[a-z\d-]+\.)+(?:salesforce\.com|force\.com|cloudforce\.com)\b/giu;
const HOME_PATH = /\/(?:Users|home)\/[^/\s]+/gu;
const QUOTED_SECRET_ASSIGNMENT =
  /(["']?(?:authorization|client_?secret|consumer_?key|cookie|password|private_?key|refresh_?token|secret|token|api_?key|jwt)["']?\s*[:=]\s*)(["'])(?!<redacted)(?:(?!\2)[^\\\r\n]|\\.)*\2/giu;
const UNQUOTED_SECRET_ASSIGNMENT =
  /(["']?(?:authorization|client_?secret|consumer_?key|cookie|password|private_?key|refresh_?token|secret|token|api_?key|jwt)["']?\s*[:=])(?!\s*(?:["']|<redacted))(\s*)([^&,\r\n}\]]+)/giu;
const SECRET_QUERY = /([?&](?:sid|session|token)=)(?!<redacted)[^&\s]+/giu;
const SUPPORT_IDENTIFIER_KEY =
  /^(?:x-(?:client-)?(?:correlation|request|trace)-id|(?:correlation|request|trace)(?:_|-)?id)$/iu;
const INLINE_SUPPORT_IDENTIFIER =
  /\b((?:correlation|request|trace)(?:[-_ ]?id)?\s*[:=]\s*)(?!<support:|<redacted)([a-f\d-]{8,})\b/giu;
const SECRET_HEADER =
  /\b((?:authorization|cookie|set-cookie|x-[a-z\d-]*token|x-[a-z\d-]*session|x-[a-z\d-]*sid)\s*:\s*)(?!<redacted>)[^\r\n]+/giu;
const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/gu;
const SECRET_FLAG =
  /^(?:-[bqt]|--(?:access-token|api-key|authorization|body|client-secret|consumer-key|cookie|filter|filters|header|ids|lookup-keys|password|private-key|query|record|refresh-token|search-key|secret|session|sid|text|token))$/iu;
const SECRET_ATTACHED_FLAG =
  /^(?:(-[bqt])|(--(?:access-token|api-key|authorization|body|client-secret|consumer-key|cookie|filter|filters|header|ids|lookup-keys|password|private-key|query|record|refresh-token|search-key|secret|session|sid|text|token)=))[\s\S]+$/iu;
const TRACE_HEADER_ALLOWLIST = new Set([
  'content-length',
  'content-type',
  'request-id',
  'retry-after',
  'sforce-limit-info',
  'x-client-trace-id',
  'x-correlation-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-request-id',
]);
const WAIT_ATTEMPTS = 100;
const STALE_LOCK_MS = 30_000;

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const fingerprint = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 12);

const isSalesforce18 = (value: string): boolean => {
  if (!/^[A-Za-z\d]{18}$/u.test(value)) return false;
  const suffix = [...Array(3).keys()]
    .map((chunk) => {
      let flags = 0;
      for (let index = 0; index < 5; index += 1) {
        const character = value[chunk * 5 + index];
        if (character >= 'A' && character <= 'Z') flags += 1 << index;
      }
      return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'[flags];
    })
    .join('');
  return value.slice(15) === suffix;
};

const isSalesforce15 = (value: string): boolean =>
  /^[A-Za-z\d]{15}$/u.test(value) && /[a-z]/u.test(value) && /[A-Z]/u.test(value) && /\d/u.test(value);

export const redactTraceString = (value: string): string =>
  value
    .replace(PRIVATE_KEY_BLOCK, '<redacted:private-key>')
    .replace(SALESFORCE_TOKEN, '<redacted:access-token>')
    .replace(BEARER, 'Bearer <redacted:token>')
    .replace(JWT, '<redacted:jwt>')
    .replace(EMAIL, (match) => `org:${fingerprint(match.toLowerCase())}`)
    .replace(ORG_ID, (match) => `org:${fingerprint(match)}`)
    .replace(SALESFORCE_HOST, '<tenant>')
    .replace(INLINE_SUPPORT_IDENTIFIER, (_, prefix: string, identifier: string) => {
      return `${prefix}<support:${fingerprint(identifier)}>`;
    })
    .replace(SALESFORCE_ID_CANDIDATE, (match) =>
      isSalesforce15(match) || isSalesforce18(match) ? `<record:${fingerprint(match)}>` : match
    )
    .replace(UUID, (match) => `<uuid:${fingerprint(match.toLowerCase())}>`)
    .replace(HOME_PATH, (match) => `${match.slice(0, match.lastIndexOf('/') + 1)}<user>`)
    .replace(SECRET_HEADER, '$1<redacted:secret>')
    .replace(SECRET_QUERY, '$1<redacted:secret>')
    .replace(QUOTED_SECRET_ASSIGNMENT, '$1$2<redacted:secret>$2')
    .replace(UNQUOTED_SECRET_ASSIGNMENT, '$1$2<redacted:secret>');

export const redactTraceValue = (value: unknown): unknown => {
  if (typeof value === 'string') return redactTraceString(value);
  if (Array.isArray(value))
    return value.map((entry, index) => {
      if (index > 0 && typeof value[index - 1] === 'string' && SECRET_FLAG.test(value[index - 1]))
        return '<redacted:secret>';
      if (typeof entry === 'string') {
        const attached = SECRET_ATTACHED_FLAG.exec(entry);
        if (attached) return `${attached[1] ?? attached[2]}<redacted:secret>`;
      }
      return redactTraceValue(entry);
    });
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      SECRET_KEY.test(key)
        ? '<redacted:secret>'
        : SUPPORT_IDENTIFIER_KEY.test(key) && entry !== null && entry !== undefined
          ? `<support:${fingerprint(String(entry))}>`
          : redactTraceValue(entry),
    ])
  );
};

const safeTraceId = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  return TRACE_ID.test(value) ? value : `trace-${fingerprint(value)}`;
};

export const traceId = (env: TraceEnvironment = process.env): string | undefined =>
  safeTraceId(env.SF_DATA360_TRACE_ID);

export const tracePath = (env: TraceEnvironment = process.env): string | undefined => env.SF_DATA360_TRACE;

export const traceEnabled = (env: TraceEnvironment = process.env): boolean => Boolean(tracePath(env) && traceId(env));

export const traceCommandReference = (env: TraceEnvironment = process.env): number | undefined => {
  const value = Number.parseInt(env.SF_DATA360_TRACE_COMMAND_SEQ ?? '', 10);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
};

export const traceHeaders = (
  headers: Readonly<Record<string, string>> = {},
  env: TraceEnvironment = process.env
): Record<string, string> => {
  const id = traceId(env);
  return id ? { ...headers, 'x-client-trace-id': id } : { ...headers };
};

export const traceHeaderMetadata = (
  headers: Headers | Readonly<Record<string, string>> = {}
): Record<string, string> => {
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  return Object.fromEntries(
    entries
      .map(([name, value]) => [name.toLowerCase(), value] as const)
      .filter(([name]) => TRACE_HEADER_ALLOWLIST.has(name))
      .map(([name, value]) => [name, redactTraceString(value)])
  );
};

export const traceEnvironment = (env: TraceEnvironment = process.env): Record<string, string> =>
  Object.fromEntries(
    ['CI', 'NODE_ENV', 'SF_API_VERSION', 'SF_TARGET_ORG', 'D360_LIVE_MUTATIONS', 'D360_LIVE_BILLABLE']
      .filter((name) => env[name] !== undefined)
      .map((name) => [name, String(redactTraceString(env[name]!))])
  );

export const tracePayload = (
  value: unknown,
  previewBytes = 1024
): { digest: string; bytes: number; preview: string } => {
  const redacted = redactTraceValue(value);
  const serialized =
    typeof redacted === 'string' ? redacted : redacted === undefined ? '' : (JSON.stringify(redacted) ?? '');
  const body = Buffer.from(serialized);
  return {
    digest: `sha256:${createHash('sha256').update(body).digest('hex')}`,
    bytes: body.byteLength,
    preview: body.subarray(0, previewBytes).toString('utf8'),
  };
};

const acquireLock = async (path: string): Promise<boolean> => {
  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return false;
      const age = await stat(path)
        .then(({ mtimeMs }) => Date.now() - mtimeMs)
        .catch(() => 0);
      if (age > STALE_LOCK_MS) {
        await rm(path, { recursive: true, force: true }).catch(() => undefined);
        continue;
      }
      await sleep(2);
    }
  }
  return false;
};

/**
 * Append one redacted JSONL event. Tracing is deliberately best effort: invalid paths, lock contention, and filesystem
 * failures never change command behavior.
 */
export const appendTraceEvent = async (
  event: TraceEvent,
  env: TraceEnvironment = process.env
): Promise<number | undefined> => {
  const path = tracePath(env);
  const sid = traceId(env);
  if (!path || !sid) return undefined;
  const lockPath = `${path}.lock`;
  let locked = false;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    locked = await acquireLock(lockPath);
    if (!locked) return undefined;
    const sequencePath = `${path}.seq`;
    let sequence = -1;
    try {
      sequence = Number.parseInt(await readFile(sequencePath, 'utf8'), 10);
      if (!Number.isInteger(sequence)) sequence = -1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;
    }
    const next = sequence + 1;
    const sequenceHandle = await open(
      sequencePath,
      constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600
    );
    try {
      await sequenceHandle.chmod(0o600);
      await sequenceHandle.writeFile(`${next}\n`);
    } finally {
      await sequenceHandle.close();
    }
    const handle = await open(
      path,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600
    );
    try {
      await handle.chmod(0o600);
      // Redact the caller-controlled event first, then add the trusted trace envelope.
      // A payload field named `sid` is sensitive and must be redacted, but the envelope
      // `sid` is the validated testbed correlation ID and must survive for validation.
      const redactedEvent = redactTraceValue(event) as Record<string, unknown>;
      const redacted = { ...redactedEvent, ts: new Date().toISOString(), seq: next, sid };
      await handle.write(`${JSON.stringify(redacted)}\n`);
    } finally {
      await handle.close();
    }
    return next;
  } catch {
    return undefined;
  } finally {
    if (locked) await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
  }
};

export const traceRootForUrl = (url: string, hint?: 'ssot' | 'core' | 'direct'): 'ssot' | 'core' | 'direct' => {
  if (hint) return hint;
  if (/\/services\/data\/v[^/]+\/ssot(?:\/|$)/u.test(url)) return 'ssot';
  if (/\/api\/v\d+(?:\/|$)/u.test(url)) return 'direct';
  return 'core';
};
