import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('../oclif.manifest.json', import.meta.url), 'utf8'));
const commands = Object.entries(manifest.commands ?? {}).sort(([left], [right]) => left.localeCompare(right));
const topics = packageJson.oclif?.topics ?? {};
const bin = new URL('../bin/run.js', import.meta.url).pathname;

const flattenTopics = (entries, prefix = '') =>
  Object.entries(entries).flatMap(([name, definition]) => {
    const topic = prefix ? `${prefix} ${name}` : name;
    return [[topic, definition], ...flattenTopics(definition.subtopics ?? {}, topic)];
  });

const declaredTopicIds = new Set(flattenTopics(topics).map(([topic]) => topic.replaceAll(' ', ':')));

const mapWithConcurrency = async (items, concurrency, callback) => {
  const remaining = [...items];
  const workers = Array.from({ length: Math.min(concurrency, remaining.length) }, async () => {
    while (remaining.length > 0) await callback(remaining.shift());
  });
  await Promise.all(workers);
};

const requireText = (value, label) => {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Missing ${label}.`);
};

if (commands.length === 0) throw new Error('The oclif manifest does not contain commands.');

for (const [id] of commands) {
  const parts = id.split(':');
  for (let length = 1; length < parts.length; length += 1) {
    const prefix = parts.slice(0, length).join(':');
    if (!declaredTopicIds.has(prefix)) throw new Error(`${id} has undeclared topic prefix ${prefix}.`);
  }
}

for (const [topic, definition] of flattenTopics(topics)) {
  const topicId = topic.replaceAll(' ', ':');
  const command = commands.find(([id]) => id === topicId || id.startsWith(`${topicId}:`));
  if (!command) throw new Error(`No command found for topic ${topic}.`);
  const topicParts = topic.split(' ');
  const topicHelp = await execute(process.execPath, [bin, ...topicParts, '--help']);
  const normalizedHelp = topicHelp.stdout.replace(/\s+/gu, ' ');
  const expectedDescription = command[0] === topicId ? command[1].description : definition.description;
  if (!normalizedHelp.includes(expectedDescription.replace(/\s+/gu, ' '))) {
    throw new Error(`Topic help does not include the expected description for ${topic}.`);
  }
}

const flexibleTaxonomyCases = [
  { alternate: ['data360', 'list', 'connection'], canonical: 'data360 connection list' },
  { alternate: ['data360', 'get', 'data-space'], canonical: 'data360 data-space get' },
];

for (const { alternate, canonical } of flexibleTaxonomyCases) {
  const result = await execute(process.execPath, [bin, ...alternate, '--help'], {
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 2 * 1024 * 1024,
  });
  const normalizedHelp = result.stdout.replace(/\s+/gu, ' ');
  if (!normalizedHelp.includes(`$ ${packageJson.oclif.bin} ${canonical}`)) {
    throw new Error(`${alternate.join(' ')} did not resolve to canonical command ${canonical}.`);
  }
}

await mapWithConcurrency(commands, 8, async ([id, command]) => {
  requireText(command.summary, `${id} summary`);
  requireText(command.description, `${id} description`);
  if (!Array.isArray(command.examples) || command.examples.length === 0) throw new Error(`Missing ${id} examples.`);
  for (const [index, example] of command.examples.entries()) requireText(example, `${id} example ${index + 1}`);

  for (const [name, flag] of Object.entries(command.flags ?? {})) {
    if (typeof flag.summary === 'string' && /^[a-z0-9-]+ option\.$/iu.test(flag.summary.trim())) {
      throw new Error(`${id} --${name} has a generic flag summary: ${flag.summary}`);
    }
  }

  const result = await execute(process.execPath, [bin, ...id.split(':'), '--help'], {
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 2 * 1024 * 1024,
  });
  const output = result.stdout.replaceAll('\r\n', '\n');
  if (!output.includes('\nDESCRIPTION\n')) throw new Error(`${id} help does not render a DESCRIPTION section.`);
  if (!output.includes('\nEXAMPLES\n')) throw new Error(`${id} help does not render an EXAMPLES section.`);
  if (!output.replace(/\s+/gu, ' ').includes(command.description.replace(/\s+/gu, ' '))) {
    throw new Error(`${id} help does not render its manifest description.`);
  }
  if (!output.includes(`$ ${packageJson.oclif.bin} ${id.replaceAll(':', ' ')}`)) {
    throw new Error(`${id} help does not render an executable example for the command.`);
  }
});

process.stdout.write(
  `Help smoke passed for ${commands.length} commands, ${flattenTopics(topics).length} topics, and ${flexibleTaxonomyCases.length} action-first forms.\n`
);
