import { loadCommandMessages } from '../messages.js';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { SfError } from '@salesforce/core';

const runtimeMessages = loadCommandMessages('data360.runtime.repl.history');

export const replHistoryPath = (
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir()
): string => join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'sf-data360', 'repl_history');

const rejectSymlink = async (path: string): Promise<void> => {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new SfError(runtimeMessages.getMessage('error.D360_API_ERROR.0'), 'D360_API_ERROR', [
        runtimeMessages.getMessage('error.D360_API_ERROR.0.actions.1'),
      ]);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

export const readReplHistory = async (path: string): Promise<string[]> => {
  try {
    await rejectSymlink(path);
    return (await readFile(path, 'utf8')).split('\n').filter(Boolean).reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

export const appendReplHistory = async (path: string, sql: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await rejectSymlink(path);
  let handle;
  try {
    handle = await open(
      path,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600
    );
    await handle.chmod(0o600);
    await handle.writeFile(`${sql.replaceAll('\n', ' ')}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new SfError(runtimeMessages.getMessage('error.D360_API_ERROR.1'), 'D360_API_ERROR', [
        runtimeMessages.getMessage('error.D360_API_ERROR.1.actions.1'),
      ]);
    }
    throw error;
  } finally {
    await handle?.close();
  }
};
