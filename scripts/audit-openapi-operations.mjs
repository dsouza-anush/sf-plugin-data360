import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const HTTP_METHODS = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace']);

const usage = `Usage: node scripts/audit-openapi-operations.mjs <official-openapi.json|-> [--output <inventory.json>]

Produces a deterministic operation inventory, tag totals, and SHA-256 for a locally supplied OpenAPI JSON file.
The script does not download or redistribute the Salesforce specification.
`;

const parseArguments = (arguments_) => {
  if (arguments_.includes('--help') || arguments_.includes('-h')) return { help: true };

  let input;
  let output;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--output') {
      output = arguments_[index + 1];
      if (!output) throw new Error('--output requires a path.');
      index += 1;
    } else if (argument.startsWith('-') && argument !== '-') {
      throw new Error(`Unknown option: ${argument}`);
    } else if (input) {
      throw new Error(`Unexpected argument: ${argument}`);
    } else {
      input = argument;
    }
  }

  if (!input) throw new Error('An OpenAPI JSON file path or - for stdin is required.');
  return { help: false, input, output };
};

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }

  const raw = options.input === '-' ? await readStdin() : await readFile(resolve(options.input), 'utf8');
  let specification;
  try {
    specification = JSON.parse(raw);
  } catch {
    throw new Error(
      'The supplied artifact is not valid JSON. Download or convert the official OpenAPI document to JSON.'
    );
  }

  if (
    !specification ||
    typeof specification !== 'object' ||
    !specification.paths ||
    typeof specification.paths !== 'object'
  ) {
    throw new Error('The supplied JSON does not contain an OpenAPI paths object.');
  }

  const operations = [];
  for (const [path, pathItem] of Object.entries(specification.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [candidateMethod, operation] of Object.entries(pathItem)) {
      const method = candidateMethod.toLowerCase();
      if (!HTTP_METHODS.has(method) || !operation || typeof operation !== 'object') continue;
      operations.push({
        method: method.toUpperCase(),
        path,
        operationId: typeof operation.operationId === 'string' ? operation.operationId : null,
        tags: Array.isArray(operation.tags) ? [...operation.tags].filter((tag) => typeof tag === 'string').sort() : [],
      });
    }
  }

  operations.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));

  const tagCounts = {};
  for (const operation of operations) {
    const tags = operation.tags.length > 0 ? operation.tags : ['(untagged)'];
    for (const tag of tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
  }

  const inventory = {
    source: {
      openapiVersion:
        typeof specification.openapi === 'string'
          ? specification.openapi
          : typeof specification.swagger === 'string'
            ? specification.swagger
            : null,
      sha256: createHash('sha256').update(raw).digest('hex'),
    },
    operationCount: operations.length,
    tagCounts: Object.fromEntries(Object.entries(tagCounts).sort(([left], [right]) => left.localeCompare(right))),
    operations,
  };
  const rendered = `${JSON.stringify(inventory, null, 2)}\n`;

  if (options.output) {
    await writeFile(resolve(options.output), rendered, 'utf8');
    process.stdout.write(
      `Audited ${inventory.operationCount} OpenAPI operations; inventory written to ${options.output} (sha256 ${inventory.source.sha256}).\n`
    );
  } else {
    process.stdout.write(rendered);
  }
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage}`);
  process.exitCode = 1;
});
