import { constants } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

export const atomicTemporaryPath = (path: string): string =>
  join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);

export const writeFileAtomic = async (path: string, contents: string | Uint8Array, mode = 0o600): Promise<void> => {
  const temporary = atomicTemporaryPath(path);
  try {
    const handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      mode
    );
    try {
      await handle.chmod(mode);
      await handle.writeFile(contents);
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};
