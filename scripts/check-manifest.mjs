import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const oclif = resolve(root, 'node_modules', 'oclif', 'bin', 'run.js');
const manifest = resolve(root, 'oclif.manifest.json');
const original = await readFile(manifest, 'utf8');
const sortObject = (value) => {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortObject(entry)])
  );
};

try {
  await execute(process.execPath, [oclif, 'manifest', root], { cwd: root });
  const generated = JSON.parse(await readFile(manifest, 'utf8'));
  const expected = await format(JSON.stringify(sortObject(generated)), { parser: 'json', printWidth: 120 });
  if (original !== expected) throw new Error(`${manifest} is stale. Run yarn manifest:generate.`);
} finally {
  await writeFile(manifest, original);
}

process.stdout.write('Official oclif manifest is fresh.\n');
