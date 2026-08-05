#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertPackageContents } from './package-contents.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packLockPaths = [resolve(root, 'yarn.lock'), resolve(root, 'oclif.lock'), resolve(root, 'npm-shrinkwrap.json')];
const packLockSnapshots = new Map(await Promise.all(packLockPaths.map(async (path) => [path, await readFile(path)])));

const run = (command, args, options = {}) =>
  new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs ?? 180_000);
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    if (options.input) child.stdin.end(options.input);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (exitCode) => {
      clearTimeout(timeout);
      const result = {
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (timedOut) {
        reject(new Error(`${command} ${args.join(' ')} exceeded the package-smoke timeout.`));
      } else if (options.allowFailure || result.exitCode === 0) done(result);
      else {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited ${result.exitCode}\n${result.stdout}${result.stderr}`.trimEnd()
          )
        );
      }
    });
  });

const temporary = await mkdtemp(join(tmpdir(), 'sf-plugin-data360-package-'));
try {
  let tarball = process.argv[2];
  if (tarball) {
    tarball = isAbsolute(tarball) ? tarball : resolve(root, tarball);
  } else {
    tarball = join(temporary, 'sf-plugin-data360.tgz');
    const yarn = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
    await run(yarn, ['pack', '--filename', tarball]);
  }
  const packageContents = await assertPackageContents(tarball);
  process.stdout.write(`PASS package content boundary (${packageContents.entries} files).\n`);

  const home = join(temporary, 'home');
  await mkdir(home, { recursive: true });
  const npmUserConfig = join(home, '.npmrc');
  await writeFile(npmUserConfig, '');
  const environment = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    SF_OCLIF_CLIENT_HOME: join(home, '.local', 'share', 'sf', 'client'),
    SF_STATE_FOLDER: join(home, '.sf'),
    SF_AUTOUPDATE_DISABLE: 'true',
    SF_DISABLE_TELEMETRY: 'true',
    npm_config_userconfig: npmUserConfig,
  };
  // Yarn exposes its host install policy to every package lifecycle. The smoke
  // test already uses an isolated home, so do not let host release-age cutoffs
  // make the nested Salesforce CLI install depend on a contributor's settings.
  for (const key of Object.keys(environment)) {
    const normalized = key.toLowerCase();
    if (normalized === 'npm_config_before' || normalized === 'npm_config_min_release_age') delete environment[key];
  }
  const sf = process.env.SF_CLI_BIN ?? 'sf';
  const tarballUrl = pathToFileURL(tarball).href;
  const allowlist = await run(sf, ['plugins', 'trust', 'allowlist', 'add', '--name', tarballUrl, '--json'], {
    env: environment,
    allowFailure: true,
  });
  await run(sf, ['plugins', 'install', tarballUrl, '--force', '--silent'], {
    env: environment,
    input: allowlist.exitCode === 0 ? undefined : 'y\n',
  });

  const plugins = await run(sf, ['plugins'], { env: environment });
  if (!plugins.stdout.includes('sf-plugin-data360')) {
    throw new Error(`Installed plugin inventory does not contain sf-plugin-data360.\n${plugins.stdout}`);
  }

  const topicHelp = await run(sf, ['data360', '--help'], { env: environment });
  if (!topicHelp.stdout.includes('Commands for Salesforce Data 360.')) {
    throw new Error(`Installed topic help is missing the Data 360 description.\n${topicHelp.stdout}`);
  }
  const commandHelp = await run(sf, ['data360', 'query', '--help'], { env: environment });
  for (const expected of ['USAGE', '--target-org', '--api-version']) {
    if (!commandHelp.stdout.includes(expected)) {
      throw new Error(`Installed query help is missing ${expected}.\n${commandHelp.stdout}`);
    }
  }

  process.stdout.write('PASS installed tarball through an isolated Salesforce CLI.\n');
} finally {
  const changedLocks = [];
  for (const [path, snapshot] of packLockSnapshots) {
    const current = await readFile(path);
    if (!current.equals(snapshot)) {
      changedLocks.push(path.slice(root.length + 1));
      await writeFile(path, snapshot);
    }
  }
  await rm(temporary, { force: true, recursive: true });
  if (changedLocks.length > 0) {
    process.stdout.write(`RESTORED tracked package lifecycle artifacts: ${changedLocks.join(', ')}.\n`);
  }
}
