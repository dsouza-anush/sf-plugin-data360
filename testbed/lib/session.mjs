import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { arch, platform, release, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from './redactor.mjs';
import { appendEvent, readEvents, writeJson } from './trace.mjs';
import { validateSessionDirectory } from './schemas.mjs';

export const testbedRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repositoryRoot = resolve(testbedRoot, '..');
export const sessionsRoot = join(testbedRoot, 'sessions');
const currentPath = join(sessionsRoot, '.current-session');
const runtimeRoot = join(tmpdir(), 'sf-data360-testbed');

const safeSlug = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z\d._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48) || 'agent';

const commandText = (command, args) => {
  try {
    return execFileSync(command, args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
  } catch {
    return 'unavailable';
  }
};

const hashTree = async () => {
  const hasher = createHash('sha256');
  const roots = [
    'bin',
    'lib',
    'messages',
    'src',
    'test/fixtures',
    'test/mock',
    'testbed/bin',
    'testbed/lib',
    'testbed/schema',
    'testbed/suites',
  ];
  const files = [
    'command-snapshot.json',
    'npm-shrinkwrap.json',
    'oclif.lock',
    'oclif.manifest.json',
    'package.json',
    'yarn.lock',
  ];
  const walk = async (relativePath) => {
    const entries = await readdir(join(repositoryRoot, relativePath), { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const child = join(relativePath, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  for (const root of roots) await walk(root);
  for (const file of files.sort()) {
    hasher
      .update(file)
      .update('\0')
      .update(await readFile(join(repositoryRoot, file)))
      .update('\0');
  }
  return `sha256:${hasher.digest('hex')}`;
};

const pluginState = async () => {
  const pkg = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
  return {
    version: pkg.version,
    commit: commandText('git', ['rev-parse', 'HEAD']),
    dirtyTree: commandText('git', ['status', '--porcelain']) !== '',
    buildHash: await hashTree(),
  };
};

const liveOrgFingerprint = (org) => {
  const output = commandText('sf', ['org', 'display', '--target-org', org, '--json']);
  if (output === 'unavailable') throw new Error(`Unable to verify live org alias: ${org}`);
  const parsed = JSON.parse(output);
  if (parsed.status !== 0 || parsed.result?.connectedStatus !== 'Connected')
    throw new Error(`Live org alias is not connected: ${org}`);
  return `org:${fingerprint(`${parsed.result.id}:${parsed.result.username}`)}`;
};

export const runtimeDirectoryForSession = (sid) => {
  const directory = resolve(runtimeRoot, sid);
  if (dirname(directory) !== resolve(runtimeRoot) || basename(directory) !== sid)
    throw new Error('Invalid session id for runtime directory.');
  return directory;
};

export const assertLiveSessionOrg = (session, selectedOrg = process.env.D360_LIVE_ORG) => {
  if (session.mode !== 'live') return undefined;
  if (!selectedOrg) throw new Error('Live sessions require D360_LIVE_ORG for every testbed command.');
  if (liveOrgFingerprint(selectedOrg) !== session.orgFingerprint)
    throw new Error('The selected live org no longer resolves to the org verified when this session started.');
  return selectedOrg;
};

export const readSession = async (sessionDirectory) =>
  JSON.parse(await readFile(join(sessionDirectory, 'session.json'), 'utf8'));

export const writeSession = async (sessionDirectory, session) =>
  writeJson(join(sessionDirectory, 'session.json'), session);

const prepareCurrentSession = async (force) => {
  let activeSid;
  try {
    activeSid = (await readFile(currentPath, 'utf8')).trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await rm(currentPath, { force: true });
    return;
  }
  const activeDirectory = resolve(sessionsRoot, activeSid);
  if (dirname(activeDirectory) !== resolve(sessionsRoot) || basename(activeDirectory) !== activeSid)
    throw new Error('Invalid active-session pointer.');
  let activeSession;
  try {
    activeSession = await readSession(activeDirectory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await rm(currentPath, { force: true });
    return;
  }
  if (activeSession.endedAt) {
    await rm(currentPath, { force: true });
    return;
  }
  if (!force) throw new Error(`A testbed session is already active: ${activeSid}`);
  const runLock = join(activeDirectory, '.run.lock');
  try {
    const age = Date.now() - (await stat(runLock)).mtimeMs;
    if (age <= 5 * 60_000)
      throw new Error(`Cannot force-abandon session ${activeSid} while its suite run lock is active.`);
    await rm(runLock, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const events = await readEvents(activeDirectory);
  const evidence = events.at(-1)?.seq;
  if (Number.isInteger(evidence)) {
    await appendEvent(activeDirectory, activeSid, {
      type: 'note',
      taxonomy: 'question',
      severity: 'info',
      text: 'Session was abandoned by an explicit testbed start --force operation.',
      evidence: [evidence],
    });
  }
  await writeSession(activeDirectory, { ...activeSession, abandonedAt: new Date().toISOString() });
  await rm(currentPath, { force: true });
};

export const startSession = async ({ agent, model, mode, org, label, force = false }) => {
  if (!agent || !model || !['mock', 'live'].includes(mode))
    throw new Error('start requires --agent, --model, and --mode mock|live');
  if (mode === 'live') {
    if (!process.env.D360_LIVE_ORG) throw new Error('live mode requires D360_LIVE_ORG');
    if (!org) org = process.env.D360_LIVE_ORG;
    if (process.env.D360_LIVE_ORG !== org) throw new Error('--org must match D360_LIVE_ORG');
  }
  await mkdir(sessionsRoot, { recursive: true, mode: 0o700 });
  await prepareCurrentSession(force);
  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, '-');
  const sid = `${timestamp}_${safeSlug(agent)}_${mode}_${randomBytes(3).toString('hex')}`;
  const sessionDirectory = join(sessionsRoot, sid);
  await mkdir(sessionDirectory, { recursive: false, mode: 0o700 });
  const session = {
    sid,
    ...(label ? { label } : {}),
    startedAt: new Date().toISOString(),
    agent,
    model,
    mode,
    ...(mode === 'live' ? { orgFingerprint: liveOrgFingerprint(org) } : {}),
    plugin: await pluginState(),
    environment: {
      sfVersion: commandText('sf', ['--version']),
      nodeVersion: process.version,
      os: `${platform()} ${release()} ${arch()}`,
      ci: process.env.CI !== undefined,
      executionMode: 'direct-compiled-plugin',
    },
    suites: [],
  };
  await writeSession(sessionDirectory, session);
  await appendEvent(sessionDirectory, sid, { type: 'session.start', manifest: session });
  await writeFile(currentPath, `${sid}\n`, { mode: 0o600 });
  return { session, sessionDirectory };
};

export const currentSessionDirectory = async () => {
  let sid;
  try {
    sid = (await readFile(currentPath, 'utf8')).trim();
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('No active testbed session. Run testbed start first.');
    throw error;
  }
  const directory = resolve(sessionsRoot, sid);
  if (dirname(directory) !== resolve(sessionsRoot) || basename(directory) !== sid)
    throw new Error('Invalid active-session pointer.');
  return directory;
};

export const updateSession = async (sessionDirectory, transform) => {
  const current = await readSession(sessionDirectory);
  const next = await transform(current);
  await writeSession(sessionDirectory, next);
  return next;
};

export const sessionTotals = (events) => {
  const outcomes = events.filter(({ type }) => type === 'scenario.end').map(({ outcome }) => outcome);
  return {
    steps: outcomes.length,
    passed: outcomes.filter((value) => value === 'pass').length,
    failed: outcomes.filter((value) => value === 'fail').length,
    blocked: outcomes.filter((value) => value === 'blocked').length,
    skipped: outcomes.filter((value) => value === 'skipped').length,
    notes: events.filter(({ type }) => type === 'note').length,
    assertions: events.filter(({ type }) => type === 'assertion').length,
    httpEvents: events.filter(({ type }) => type === 'http.request' || type === 'http.response').length,
  };
};

export const endSession = async (sessionDirectory) => {
  const session = await readSession(sessionDirectory);
  if (session.endedAt) throw new Error(`Session already ended: ${session.sid}`);
  const events = await readEvents(sessionDirectory);
  const totals = sessionTotals(events);
  await appendEvent(sessionDirectory, session.sid, { type: 'session.end', totals });
  const ended = {
    ...session,
    endedAt: new Date().toISOString(),
    totals,
    validation: { schemaValid: false, leakScanClean: false },
  };
  await writeSession(sessionDirectory, ended);
  await Promise.all([
    rm(runtimeDirectoryForSession(session.sid), { recursive: true, force: true }),
    rm(join(sessionDirectory, 'home'), { recursive: true, force: true }),
  ]);
  const validation = await validateSessionDirectory(sessionDirectory);
  const final = {
    ...ended,
    validation: {
      schemaValid: validation.valid,
      leakScanClean: !validation.errors.some((value) => /leak/iu.test(value)),
    },
  };
  await writeSession(sessionDirectory, final);
  const finalValidation = await validateSessionDirectory(sessionDirectory);
  if (resolve(sessionDirectory) === resolve(await currentSessionDirectory())) await rm(currentPath, { force: true });
  if (!finalValidation.valid) throw new Error(`Session validation failed: ${finalValidation.errors.join('; ')}`);
  return { session: final, validation: finalValidation };
};
