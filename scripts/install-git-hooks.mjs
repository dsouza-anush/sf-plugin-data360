import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, '.githooks', 'pre-push');
const destination = resolve(root, '.git', 'hooks', 'pre-push');

try {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o755);
  process.stdout.write('Installed repository pre-push hook.\n');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  process.stdout.write('Skipped git hook installation outside a Git checkout.\n');
}
