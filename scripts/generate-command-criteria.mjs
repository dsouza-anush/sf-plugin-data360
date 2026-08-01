import { readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';

const root = new URL('../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const snapshot = await readJson('command-snapshot.json');
const commandMetadata = await readJson('test/command-metadata.json');
const oclif = await readJson('oclif.manifest.json');
const pass = (evidence) => ({ status: 'pass', evidence });
const adopted = (evidence) => ({
  status: 'adopted',
  evidence,
  limitation: 'The referenced family lifecycle test is adoption evidence, not a criterion-specific assertion.',
});
const notApplicable = (reason) => ({ status: 'n/a', reason });
const billable = new Set([
  'data360 data-graph refresh',
  'data360 ingest',
  'data360 ingest bulk',
  'data360 identity-resolution run',
  'data360 query',
  'data360 query hybrid',
  'data360 query vector',
  'data360 segment publish',
  'data360 transform run',
  'data360 calculated-insight run',
  'data360 data-stream run',
]);
const continuation = new Map([
  ['data360 query', 'sf data360 query resume -r'],
  ['data360 ingest bulk', 'sf data360 ingest resume -r'],
  ['data360 transform run', 'sf data360 transform report -n <name>'],
  ['data360 identity-resolution run', 'sf data360 identity-resolution get -n <name>'],
  ['data360 segment publish', 'sf data360 segment get -n <name>'],
  ['data360 data-stream run', 'sf data360 data-stream get -n <name>'],
  ['data360 data-kit deploy', 'sf data360 data-kit component status --name <kit> --component <component-name>'],
  ['data360 data-kit undeploy', 'sf data360 data-kit component status --name <kit> --component <component-name>'],
]);
const jobCommands = new Set(['data360 query', 'data360 ingest bulk', 'data360 segment publish']);
const partialExitCommands = new Set([
  'data360 mapping update',
  'data360 ingest bulk',
  'data360 ingest resume',
  'data360 ingest report',
]);
const timeoutExitCommands = new Set([
  'data360 query',
  'data360 query resume',
  'data360 ingest bulk',
  'data360 ingest resume',
  'data360 segment publish',
]);
const runtimeEvidence = (metadata) => `${metadata.testFile}#${metadata.testPattern}`;
const universalEvidence = {
  U1: 'test/command-criteria.test.ts#proves U1 help and U4 flag conventions for every command artifact',
  U2: [
    'test/command-criteria-parser.test.ts#rejects unknown flags for every shipped command through the actual oclif parser',
    'test/command-criteria-parser.test.ts#rejects every omitted non-org required flag through the actual oclif parser',
  ].join('; '),
  U3: 'test/command-criteria-parser.test.ts#enforces every declared exclusive and dependent flag relationship',
  U4: 'test/command-criteria.test.ts#proves U1 help and U4 flag conventions for every command artifact',
  U5: 'test/command-criteria.test.ts#proves U5 JSON schemas and U11 assigned exit-code matrices for every command',
  U6: 'test/command-criteria.test.ts#proves U6 U7 and U15 stream and timing invariants through the shared command boundary',
  U7: 'test/command-criteria.test.ts#proves U6 U7 and U15 stream and timing invariants through the shared command boundary',
  U8: [
    'test/ingest.test.ts#uses plain stderr progress outside TTYs, suppresses JSON, and reports failures without completing',
    'test/foundation.test.ts#enforces the exact destructive confirmation decision matrix',
  ].join('; '),
  U9: 'test/foundation.test.ts#normalizes API errors into stable SfError codes',
  U10: 'test/foundation.test.ts#normalizes Salesforce arrays and stable error mappings',
  U11: [
    'test/command-criteria.test.ts#proves U5 JSON schemas and U11 assigned exit-code matrices for every command',
    'test/command-criteria-parser.test.ts#rejects unknown flags for every shipped command through the actual oclif parser',
  ].join('; '),
  U12: [
    'test/command-criteria.test.ts#proves U12 target-org config default through a real command parser',
    'test/command-criteria.test.ts#proves U12 missing target-org default fails cleanly through a real command parser',
  ].join('; '),
  U13: 'test/command-criteria.test.ts#proves U13 api-version propagation and absence of hardcoded API paths',
  U14: 'test/command-criteria.test.ts#proves U14 data-space precedence through the real resolver',
  U15: 'test/command-criteria.test.ts#proves U6 U7 and U15 stream and timing invariants through the shared command boundary',
};

const classify = (id, flags) => {
  const leaf = id.split(' ').at(-1);
  const classes = [];
  if (['list', 'available', 'dependencies'].includes(leaf) || id === 'data360 activation platforms')
    classes.push('list');
  if (['get', 'describe', 'display', 'lookup', 'results', 'report', 'manifest', 'status'].includes(leaf))
    classes.push('get');
  if (['create', 'update', 'set', 'validate'].includes(leaf)) classes.push('mutation');
  if (flags.includes('no-prompt')) classes.push('destructive');
  if (['run', 'retry', 'publish', 'refresh', 'deactivate', 'cancel', 'deploy', 'undeploy'].includes(leaf))
    classes.push('action');
  if (jobCommands.has(id)) classes.push('job');
  return classes;
};

const classCriteria = (id, classes, flags, metadata) => {
  const evidence = runtimeEvidence(metadata);
  const result = {};
  if (classes.includes('list')) {
    result.L1 = adopted(evidence);
    result.L2 =
      flags.includes('all') && flags.includes('limit')
        ? adopted(evidence)
        : notApplicable('This finite reference/list endpoint does not declare --all and --limit pagination.');
    result.L3 = adopted(evidence);
    result.L4 = flags.includes('result-format')
      ? adopted(evidence)
      : notApplicable('This list command does not declare alternate result formats.');
  }
  if (classes.includes('get')) {
    result.G1 = flags.includes('name')
      ? adopted(evidence)
      : notApplicable('This read uses explicit identifiers or fixed reference data rather than name-or-ID resolution.');
    result.G2 = adopted(evidence);
  }
  if (classes.includes('mutation')) {
    result.M1 = flags.includes('file')
      ? adopted(evidence)
      : notApplicable('This mutation uses typed flags or an existing resource and accepts no definition file.');
    result.M2 = adopted(metadata.wire ? `${metadata.wire.method} ${metadata.wire.path}; ${evidence}` : evidence);
    result.M3 = adopted(evidence);
  }
  if (classes.includes('destructive')) {
    result.D1 = pass('test/foundation.test.ts#enforces the exact destructive confirmation decision matrix');
    result.D2 = adopted(evidence);
  }
  if (classes.includes('action')) {
    result.A1 = billable.has(id) ? adopted(evidence) : notApplicable('This action is not documented as billable.');
    result.A2 = adopted(metadata.wire ? `${metadata.wire.method} ${metadata.wire.path}; ${evidence}` : evidence);
    result.A3 = continuation.has(id)
      ? adopted(`${continuation.get(id)}; ${evidence}`)
      : notApplicable('This action is synchronous or has no documented continuation command.');
  }
  if (billable.has(id) && !result.A1) result.A1 = adopted(evidence);
  if (classes.includes('job')) {
    if (id === 'data360 segment publish') {
      result.J1 = adopted('test/p5-segment.test.ts#runs every shipped command through exact keys');
      result.J2 = pass('test/p5-segment.test.ts#uses exit 69 and a continuation action when publish polling times out');
      result.J3 = notApplicable('Segment publish has no asynchronous-return flag.');
      result.J4 = notApplicable('Segment publish uses segment get and has no resume command.');
      result.J5 = notApplicable('Segment publish has no documented partial-success state.');
      result.J6 = notApplicable('Segment publish has no cancel operation.');
    } else {
      const query = id === 'data360 query';
      const file = query ? 'test/query.test.ts' : 'test/ingest.test.ts';
      result.J1 = query
        ? pass(`${file}#returns the final Finished status after polling and fetches rows`)
        : adopted(`${file}#runs all seven commands`);
      result.J2 = pass(
        `${file}#${query ? 'throws the timeout and failure contracts' : 'retains ingest jobs for seven days and returns exact timeout metadata'}`
      );
      result.J3 = query
        ? pass(`${file}#prints exact async hints only in human mode`)
        : adopted(`${file}#runs all seven commands`);
      result.J4 = query
        ? pass(`${file}#uses cached resume output defaults and lets explicit flags win`)
        : adopted(`${file}#runs all seven commands through exchange`);
      result.J5 = query
        ? notApplicable('Query SQL has no documented partial-success exit-68 state.')
        : pass('test/ingest.test.ts#attaches discoverable job IDs and exact recovery actions to upload/cache errors');
      result.J6 = adopted(
        `${file}#${query ? 'executes explicitly confirmed cancel through the real parser' : 'runs all seven commands'}`
      );
    }
  }
  return result;
};

const records = {};
for (const command of snapshot.commands) {
  const id = command.id;
  const metadata = commandMetadata[id];
  const definition = oclif.commands[id.replaceAll(' ', ':')];
  if (!metadata || !definition) throw new Error(`Missing source metadata for ${id}.`);
  const flags = Object.values(definition.flags ?? {});
  const requiredFlags = flags
    .filter(({ required }) => required)
    .map(({ name }) => name)
    .sort();
  const optionalFlags = flags
    .filter(({ required }) => !required)
    .map(({ name }) => name)
    .sort();
  const flagNames = flags.map(({ name }) => name);
  const relationships = flags.flatMap(({ name, exclusive = [], dependsOn = [] }) => [
    ...exclusive.map((other) => `${name} excludes ${other}`),
    ...dependsOn.map((other) => `${name} depends on ${other}`),
  ]);
  const classes = classify(id, flagNames);
  const schema = definition.enableJsonFlag ? `schemas/${id.replaceAll(' ', '.')}.json` : null;
  const universal = {
    U1: pass(`oclif.manifest.json; messages/${id.replaceAll(' ', '.')}.md; ${universalEvidence.U1}`),
    U2: pass(universalEvidence.U2),
    U3:
      relationships.length > 0
        ? pass(`oclif relationships: ${relationships.join(', ')}; ${universalEvidence.U3}`)
        : notApplicable('The command declares no exclusive or dependent flag combinations.'),
    U4: pass(`oclif.manifest.json short-character and kebab-case audit; ${universalEvidence.U4}`),
    U5: schema
      ? pass(`${schema}; ${universalEvidence.U5}`)
      : notApplicable('Raw api request intentionally preserves bytes and exposes no JSON envelope.'),
    U6: pass(universalEvidence.U6),
    U7: pass(universalEvidence.U7),
    U8: definition.enableJsonFlag
      ? pass(universalEvidence.U8)
      : notApplicable('The raw api request command has no JSON mode.'),
    U9: pass(universalEvidence.U9),
    U10:
      id === 'data360 open'
        ? notApplicable('The local browser command makes no Data 360 HTTP request.')
        : pass(universalEvidence.U10),
    U11: pass(universalEvidence.U11),
    U12: flagNames.includes('target-org')
      ? pass(`oclif target-org metadata; ${universalEvidence.U12}`)
      : notApplicable('This local command does not resolve an org.'),
    U13: flagNames.includes('api-version')
      ? pass(`${universalEvidence.U13}; scripts/evaluate-release-criteria.mjs hardcoded-version audit`)
      : notApplicable('This command makes no versioned Data 360 API request.'),
    U14: flagNames.includes('data-space')
      ? pass(universalEvidence.U14)
      : notApplicable('The command has no data-space input.'),
    U15: flagNames.includes('timing')
      ? pass(universalEvidence.U15)
      : notApplicable('The command performs no timed Data 360 request.'),
  };
  records[id] = {
    shape: id.split(' ').slice(1).join(' '),
    requiredFlags,
    optionalFlags,
    flagRelationships: relationships,
    schema,
    fixtures: metadata.fixtures,
    errors: metadata.errors,
    statuses: [0, 1, 2, ...(partialExitCommands.has(id) ? [68] : []), ...(timeoutExitCommands.has(id) ? [69] : [])],
    wire: metadata.wire ?? null,
    classes,
    allowedExceptions: Object.fromEntries(
      Object.entries(universal)
        .filter(([, criterion]) => criterion.status === 'n/a')
        .map(([criterion, { reason }]) => [criterion, reason])
    ),
    universal,
    classCriteria: classCriteria(id, classes, flagNames, metadata),
  };
}

const output = await format(`${JSON.stringify(records)}\n`, { parser: 'json', printWidth: 120 });
const path = new URL('test/command-criteria.json', root);
if (process.argv.includes('--check')) {
  if ((await readFile(path, 'utf8')) !== output) throw new Error('test/command-criteria.json is stale.');
  process.stdout.write(`Command criteria manifest is fresh (${Object.keys(records).length} commands).\n`);
} else {
  await writeFile(path, output);
  process.stdout.write(`Generated command criteria for ${Object.keys(records).length} commands.\n`);
}
