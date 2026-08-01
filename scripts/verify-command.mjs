import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const raw = process.argv[2];
if (!raw) throw new Error('Usage: yarn verify:command <data360:command[:subcommand]>');
const parts = raw.replaceAll(':', ' ').trim().split(/\s+/u);
const id = parts.join(' ');
const artifact = parts.join('.');
const messagePath = resolve(root, 'messages', `${artifact}.md`);
const schemaPath = resolve(root, 'schemas', `${artifact}.json`);

await access(messagePath);
const message = await readFile(messagePath, 'utf8');
const examples = message.match(/<%= config\.bin %> <%= command\.id %>/gu) ?? [];
if (!message.includes('# summary') || !message.includes('# description') || examples.length < 2) {
  throw new Error(`${messagePath} must contain summary, description, and at least two interpolated examples.`);
}
if (id !== 'data360 api request') await access(schemaPath);

const snapshot = JSON.parse(await readFile(resolve(root, 'command-snapshot.json'), 'utf8'));
if (!snapshot.commands.some((command) => command.id === id))
  throw new Error(`${id} is missing from command-snapshot.json.`);

const metadata = JSON.parse(await readFile(resolve(root, 'test', 'command-metadata.json'), 'utf8'));
const command = metadata[id];
if (!command) throw new Error(`${id} is missing explicit command verification metadata.`);
if (
  /^data360 (connection|connector|dlo|dmo|mapping|data-stream|transform|data-space)( |$)/u.test(id) &&
  (!command.wire?.method || !command.wire?.path)
) {
  throw new Error(`${id} is missing its explicit expected wire method/path contract.`);
}
const test = await readFile(resolve(root, command.testFile), 'utf8');
if (!test.includes(command.testPattern)) {
  throw new Error(`${command.testFile} does not contain the declared test case for ${id}: ${command.testPattern}`);
}
for (const fixture of command.fixtures) await access(resolve(root, fixture));
for (const flag of command.flags) {
  if (!message.includes(`# flags.${flag}.summary`)) {
    throw new Error(`${messagePath} is missing # flags.${flag}.summary.`);
  }
}
for (const code of command.errors) {
  if (!message.includes(`# error.${code}`) || !message.includes(`# error.${code}.actions`)) {
    throw new Error(`${messagePath} is missing message and actions sections for ${code}.`);
  }
}

process.stdout.write(`Verified ${id}\n`);
