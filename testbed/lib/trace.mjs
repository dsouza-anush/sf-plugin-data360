import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { digest, redactValue, serializeRedacted } from './redactor.mjs';

const WAIT_ATTEMPTS = 100;
const STALE_LOCK_MS = 30_000;

const sleep = async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const acquireLock = async (path) => {
  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(path);
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const age = await stat(path)
        .then(({ mtimeMs }) => Date.now() - mtimeMs)
        .catch(() => 0);
      if (age > STALE_LOCK_MS) {
        await rm(path, { recursive: true, force: true });
        continue;
      }
      await sleep(2);
    }
  }
  throw new Error(`Timed out acquiring trace lock: ${path}`);
};

export const eventsPath = (sessionDirectory) => join(sessionDirectory, 'events.jsonl');

export const appendEvent = async (sessionDirectory, sid, event) => {
  const path = eventsPath(sessionDirectory);
  const lockPath = `${path}.lock`;
  await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
  await acquireLock(lockPath);
  try {
    const sequencePath = `${path}.seq`;
    let sequence = -1;
    try {
      sequence = Number.parseInt(await readFile(sequencePath, 'utf8'), 10);
      if (!Number.isInteger(sequence)) sequence = -1;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const next = sequence + 1;
    await writeFile(sequencePath, `${next}\n`, { mode: 0o600 });
    const handle = await open(
      path,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600
    );
    try {
      const value = redactValue({ ts: new Date().toISOString(), seq: next, sid, ...event });
      await handle.write(`${JSON.stringify(value)}\n`);
    } finally {
      await handle.close();
    }
    return next;
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
};

export const readEvents = async (sessionDirectory) => {
  try {
    return (await readFile(eventsPath(sessionDirectory), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          throw new Error(`Invalid JSON on events.jsonl line ${index + 1}: ${error.message}`);
        }
      });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

export const assertEvidenceSequences = (events, evidence) => {
  const known = new Set(events.map(({ seq }) => seq).filter(Number.isInteger));
  const missing = evidence.filter((seq) => !known.has(seq));
  if (missing.length > 0) {
    throw new Error(`--evidence references unknown event seq: ${missing.join(', ')}`);
  }
};

export const closeOpenTraceEvents = async (
  sessionDirectory,
  sid,
  { afterSequence = -1, exitCode = 1, durationMs = 0, timedOut = true } = {}
) => {
  const events = (await readEvents(sessionDirectory)).filter(({ seq }) => seq > afterSequence);
  const commandResults = new Set(events.filter(({ type }) => type === 'command.result').map(({ seqRef }) => seqRef));
  const httpResponses = new Set(
    events.filter(({ type }) => type === 'http.response').map(({ requestRef }) => requestRef)
  );
  const recovered = { commands: 0, requests: 0 };
  for (const request of events.filter(({ type }) => type === 'http.request')) {
    if (httpResponses.has(request.seq)) continue;
    await appendEvent(sessionDirectory, sid, {
      type: 'http.response',
      seqRef: request.seqRef,
      requestRef: request.seq,
      root: request.root,
      status: 0,
      statusInferred: true,
      durationMs,
      retryAttempt: request.retryAttempt,
      timedOut,
    });
    recovered.requests += 1;
  }
  for (const command of events.filter(({ type }) => type === 'command.exec')) {
    if (commandResults.has(command.seq)) continue;
    await appendEvent(sessionDirectory, sid, {
      type: 'command.result',
      seqRef: command.seq,
      exitCode,
      durationMs,
      timedOut,
    });
    recovered.commands += 1;
  }
  return recovered;
};

export const writeJson = async (path, value, mode = 0o600) => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(redactValue(value), undefined, 2)}\n`, { mode });
  try {
    await rename(temporary, path);
  } catch (error) {
    // POSIX rename replaces atomically. Windows can reject an existing target.
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    await rm(path, { force: true });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
};

export const payloadReference = async (value, sessionDirectory, previewKind = 'preview4k') => {
  const serialized = serializeRedacted(value);
  const bytes = Buffer.byteLength(serialized);
  const hash = digest(serialized);
  const cap = previewKind === 'preview256' ? 256 : 4096;
  const result = {
    digest: `sha256:${hash}`,
    bytes,
    [previewKind]: Buffer.from(serialized).subarray(0, cap).toString('utf8'),
  };
  if (bytes > 4096) {
    const rawDirectory = join(sessionDirectory, 'raw');
    const rawPath = join(rawDirectory, `sha256-${hash}.txt`);
    await mkdir(rawDirectory, { recursive: true, mode: 0o700 });
    await writeFile(rawPath, serialized, { mode: 0o600 });
    result.rawFile = relative(sessionDirectory, rawPath);
  }
  return result;
};
