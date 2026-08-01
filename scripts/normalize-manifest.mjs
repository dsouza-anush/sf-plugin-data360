import { readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';

const manifest = new URL('../oclif.manifest.json', import.meta.url);
const sortObject = (value) => {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortObject(entry)])
  );
};

const normalized = await format(JSON.stringify(sortObject(JSON.parse(await readFile(manifest, 'utf8')))), {
  parser: 'json',
  printWidth: 120,
});
await writeFile(manifest, normalized);
