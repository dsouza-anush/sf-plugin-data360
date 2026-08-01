import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'schemas');
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

for (const file of (await readdir(directory)).filter((name) => name.endsWith('.json'))) {
  const schema = JSON.parse(await readFile(resolve(directory, file), 'utf8'));
  ajv.compile(schema);
}
process.stdout.write('All command schemas compile.\n');
