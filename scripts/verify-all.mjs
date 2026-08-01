import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await readFile(resolve(root, 'test', 'command-metadata.json'), 'utf8'));

for (const command of Object.keys(metadata).sort()) {
  await execute(process.execPath, [resolve(root, 'scripts', 'verify-command.mjs'), command.replaceAll(' ', ':')], {
    cwd: root,
  });
}

process.stdout.write(`Verified all ${Object.keys(metadata).length} commands.\n`);
