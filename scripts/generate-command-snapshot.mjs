import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { format } from 'prettier';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commandsRoot = resolve(root, 'lib', 'commands');

const files = [];
const walk = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.js')) files.push(path);
  }
};
await walk(commandsRoot);

const commands = [];
for (const file of files.sort()) {
  const command = (await import(pathToFileURL(file).href)).default;
  if (!command) continue;
  const id = relative(commandsRoot, file).replace(/\.js$/u, '').split(sep).join(' ');
  commands.push({
    id,
    state: command.state ?? 'stable',
    summary: command.summary ?? '',
    args: Object.keys(command.args ?? {}).sort(),
    flags: Object.keys(command.flags ?? {}).sort(),
    json: command.enableJsonFlag !== false,
  });
}

const path = resolve(root, 'command-snapshot.json');
const expected = await format(JSON.stringify({ commands }), { parser: 'json', printWidth: 120 });
if (process.argv.includes('--check')) {
  if ((await readFile(path, 'utf8')) !== expected) {
    throw new Error(`${path} is stale. Run yarn snapshot:generate.`);
  }
  process.stdout.write('Command snapshot is fresh.\n');
} else {
  await writeFile(path, expected);
}
