import { access, readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const snapshot = await readJson('command-snapshot.json');
const metadata = await readJson('test/command-metadata.json');
const criteriaManifest = await readJson('test/command-criteria.json');
const verification = await readJson('test/verification.json');
const oclif = await readJson('oclif.manifest.json');
const commands = snapshot.commands;
const commandIds = commands.map(({ id }) => id);
const commandSet = new Set(commandIds);
const failures = [];
const testSources = new Map();
const approvedUniversalEvidence = {
  U1: ['test/command-criteria.test.ts#proves U1 help and U4 flag conventions for every command artifact'],
  U2: [
    'test/command-criteria-parser.test.ts#rejects unknown flags for every shipped command through the actual oclif parser',
    'test/command-criteria-parser.test.ts#rejects every omitted non-org required flag through the actual oclif parser',
  ],
  U3: ['test/command-criteria-parser.test.ts#enforces every declared exclusive and dependent flag relationship'],
  U4: ['test/command-criteria.test.ts#proves U1 help and U4 flag conventions for every command artifact'],
  U5: ['test/command-criteria.test.ts#proves U5 JSON schemas and U11 assigned exit-code matrices for every command'],
  U6: [
    'test/command-criteria.test.ts#proves U6 U7 and U15 stream and timing invariants through the shared command boundary',
  ],
  U7: [
    'test/command-criteria.test.ts#proves U6 U7 and U15 stream and timing invariants through the shared command boundary',
  ],
  U8: [
    'test/ingest.test.ts#uses plain stderr progress outside TTYs, suppresses JSON, and reports failures without completing',
    'test/foundation.test.ts#enforces the exact destructive confirmation decision matrix',
  ],
  U9: ['test/foundation.test.ts#normalizes API errors into stable SfError codes'],
  U10: ['test/foundation.test.ts#normalizes Salesforce arrays and stable error mappings'],
  U11: [
    'test/command-criteria.test.ts#proves U5 JSON schemas and U11 assigned exit-code matrices for every command',
    'test/command-criteria-parser.test.ts#rejects unknown flags for every shipped command through the actual oclif parser',
  ],
  U12: [
    'test/command-criteria.test.ts#proves U12 target-org config default through a real command parser',
    'test/command-criteria.test.ts#proves U12 missing target-org default fails cleanly through a real command parser',
  ],
  U13: ['test/command-criteria.test.ts#proves U13 api-version propagation and absence of hardcoded API paths'],
  U14: ['test/command-criteria.test.ts#proves U14 data-space precedence through the real resolver'],
  U15: [
    'test/command-criteria.test.ts#proves U6 U7 and U15 stream and timing invariants through the shared command boundary',
  ],
};

const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const readTree = async (directory) => {
  const contents = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name, directory);
    if (entry.isDirectory()) contents.push(...(await readTree(new URL(`${entry.name}/`, directory))));
    else if (entry.name.endsWith('.ts')) contents.push(await readFile(path, 'utf8'));
  }
  return contents;
};
const readFixtureTree = async (directory, relativeDirectory = 'test/fixtures') => {
  const fixtures = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name, directory);
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      fixtures.push(...(await readFixtureTree(new URL(`${entry.name}/`, directory), relativePath)));
    } else if (entry.name.endsWith('.json') && entry.name !== 'manifest.json') {
      fixtures.push({ path: relativePath, value: JSON.parse(await readFile(path, 'utf8')) });
    }
  }
  return fixtures;
};
const fixtureProvenance = (fixture) => (Array.isArray(fixture) ? fixture[0]?.__fixture : fixture?.__fixture);
const verifyTestReferences = async (command, criterion, evidence, required, approved = undefined, exact = false) => {
  const references = [...evidence.matchAll(/(test\/[^#;]+\.ts)#([^;]+)/gu)];
  check(!required || references.length > 0, `${command}: ${criterion} lacks a test reference`);
  for (const [, file, pattern] of references) {
    if (!testSources.has(file)) testSources.set(file, await readFile(new URL(file, root), 'utf8'));
    check(
      testSources.get(file).includes(pattern.trim()),
      `${command}: ${criterion} references missing test "${pattern}"`
    );
    if (exact) {
      check(
        testSources.get(file).includes(`it('${pattern.trim()}'`) ||
          testSources.get(file).includes(`it("${pattern.trim()}"`),
        `${command}: ${criterion} evidence is not an exact test title "${file}#${pattern.trim()}"`
      );
    }
  }
  if (approved) {
    const actual = references.map(([, file, pattern]) => `${file}#${pattern.trim()}`);
    for (const reference of approved) {
      check(actual.includes(reference), `${command}: ${criterion} lacks approved evidence "${reference}"`);
      const [file, pattern] = reference.split('#', 2);
      if (!testSources.has(file)) testSources.set(file, await readFile(new URL(file, root), 'utf8'));
      check(
        testSources.get(file).includes(`it('${pattern}'`) || testSources.get(file).includes(`it("${pattern}"`),
        `${command}: ${criterion} approved evidence is not an exact test title "${reference}"`
      );
    }
    for (const reference of actual) {
      check(approved.includes(reference), `${command}: ${criterion} uses unapproved evidence "${reference}"`);
    }
  }
};

check(commands.length === 135, `command snapshot has ${commands.length}, expected 135`);
check(Object.keys(metadata).length === commands.length, 'command metadata count differs from snapshot');
check(Object.keys(criteriaManifest).length === commands.length, 'command criteria count differs from snapshot');
check(verification.length === commands.length, 'verification row count differs from snapshot');
check(new Set(commandIds).size === commands.length, 'command snapshot contains duplicate IDs');
check(
  new Set(verification.map(({ command }) => command)).size === verification.length,
  'verification contains duplicate IDs'
);
const liveEvidenceByCommand = new Map();
for (const fixture of await readFixtureTree(new URL('test/fixtures/', root))) {
  const provenance = fixtureProvenance(fixture.value);
  if (provenance?.source !== 'live-scrubbed') continue;
  if (!provenance.command && !provenance.recordedAt) continue;
  check(Boolean(provenance.command), `${fixture.path}: associated live evidence lacks a command`);
  check(Boolean(provenance.recordedAt), `${fixture.path}: associated live evidence lacks recordedAt`);
  if (!provenance.command || !provenance.recordedAt) continue;
  check(commandSet.has(provenance.command), `${fixture.path}: live evidence names an unshipped command`);
  check(
    /^\d{4}-\d{2}-\d{2}$/u.test(provenance.recordedAt),
    `${fixture.path}: live evidence recordedAt must be an ISO date`
  );
  const entries = liveEvidenceByCommand.get(provenance.command) ?? [];
  entries.push({ path: fixture.path, provenance });
  liveEvidenceByCommand.set(provenance.command, entries);
}

for (const command of commands) {
  check(/^[A-Z].*\.$/u.test(command.summary), `${command.id}: summary must be capitalized and end with a period`);
  check(
    command.flags.every((flag) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(flag)),
    `${command.id}: flags must be kebab-case`
  );
  const entry = metadata[command.id];
  const criteria = criteriaManifest[command.id];
  const definition = oclif.commands[command.id.replaceAll(' ', ':')];
  check(Boolean(entry), `${command.id}: missing command metadata`);
  check(Boolean(criteria), `${command.id}: missing command criteria`);
  if (!entry || !criteria) continue;
  const actualFlags = [...(criteria.requiredFlags ?? []), ...(criteria.optionalFlags ?? [])];
  const expectedNotApplicable = {
    U3: (criteria.flagRelationships ?? []).length === 0,
    U5: command.id === 'data360 api request',
    U8: command.id === 'data360 api request',
    U10: command.id === 'data360 open',
    U13: !actualFlags.includes('api-version'),
    U14: !actualFlags.includes('data-space'),
    U15: !actualFlags.includes('timing'),
  };
  check(Array.isArray(entry.fixtures) && entry.fixtures.length > 0, `${command.id}: requires at least one fixture`);
  for (const fixture of entry.fixtures ?? []) await access(new URL(fixture, root));
  const message = await readFile(new URL(`messages/${command.id.replaceAll(' ', '.')}.md`, root), 'utf8');
  check(
    (message.match(/<%= config\.bin %> <%= command\.id %>/gu) ?? []).length >= 2,
    `${command.id}: needs two examples`
  );
  for (const flag of entry.flags ?? []) {
    check(message.includes(`# flags.${flag}.summary`), `${command.id}: missing message summary for --${flag}`);
  }
  for (let index = 1; index <= 15; index += 1) {
    const id = `U${index}`;
    const criterion = criteria.universal?.[id];
    check(Boolean(criterion), `${command.id}: missing ${id}`);
    if (!criterion) continue;
    if (id in expectedNotApplicable) {
      check(
        (criterion.status === 'n/a') === expectedNotApplicable[id],
        `${command.id}: ${id} applicability does not match command metadata`
      );
    }
    check(['pass', 'n/a'].includes(criterion.status), `${command.id}: invalid ${id} status`);
    if (criterion.status === 'pass') {
      check(Boolean(criterion.evidence), `${command.id}: ${id} lacks evidence`);
      if (criterion.evidence)
        await verifyTestReferences(command.id, id, criterion.evidence, true, approvedUniversalEvidence[id]);
    } else {
      check(Boolean(criterion.reason), `${command.id}: ${id} lacks an N/A reason`);
      check(criteria.allowedExceptions?.[id] === criterion.reason, `${command.id}: ${id} exception is not registered`);
    }
  }
  if (criteria.universal.U8?.status === 'pass') {
    check(definition?.enableJsonFlag === true, `${command.id}: U8 requires the global JSON flag`);
  }
  if (criteria.universal.U12?.status === 'pass') {
    check(definition?.flags?.['target-org']?.type === 'option', `${command.id}: U12 target-org must be an org option`);
    check(
      definition?.flags?.['target-org']?.noCacheDefault === true,
      `${command.id}: U12 target-org must re-resolve its config default`
    );
  }
  const expectedClassCriteria = {
    list: ['L1', 'L2', 'L3', 'L4'],
    get: ['G1', 'G2'],
    mutation: ['M1', 'M2', 'M3'],
    destructive: ['D1', 'D2'],
    action: ['A1', 'A2', 'A3'],
    job: ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'],
  };
  const commandSource = await readFile(new URL(`src/commands/${command.id.split(' ').join('/')}.ts`, root), 'utf8');
  const sharedBehaviorSources = [commandSource];
  if (commandSource.includes('createRegistryCommand')) {
    sharedBehaviorSources.push(await readFile(new URL('src/resources/registry.ts', root), 'utf8'));
  }
  if (commandSource.includes('executeSearchQuery')) {
    sharedBehaviorSources.push(
      await readFile(new URL('src/query/searchCommand.ts', root), 'utf8'),
      await readFile(new URL('src/commands/data360/query.ts', root), 'utf8')
    );
  }
  const sharedBehaviorSource = sharedBehaviorSources.join('\n');
  if (criteria.classes?.includes('destructive')) {
    check(
      sharedBehaviorSource.includes('confirmDestructive') ||
        (commandSource.includes('createRegistryCommand') && commandSource.includes("operation: 'delete'")),
      `${command.id}: destructive command is not wired to shared confirmation`
    );
  }
  if (['pass', 'adopted'].includes(criteria.classCriteria?.A1?.status)) {
    check(
      sharedBehaviorSource.includes('resolveCreditNotices'),
      `${command.id}: billable command is not wired to credit notices`
    );
  }
  for (const classification of criteria.classes ?? []) {
    for (const classCriterion of expectedClassCriteria[classification] ?? []) {
      const record = criteria.classCriteria?.[classCriterion];
      check(Boolean(record), `${command.id}: ${classification} lacks ${classCriterion}`);
      check(
        ['pass', 'adopted', 'n/a'].includes(record?.status),
        `${command.id}: ${classCriterion} has invalid status ${record?.status}`
      );
      check(
        !['pass', 'adopted'].includes(record?.status) || Boolean(record.evidence),
        `${command.id}: ${classCriterion} lacks behavioral evidence`
      );
      if (['pass', 'adopted'].includes(record?.status) && record.evidence) {
        await verifyTestReferences(
          command.id,
          classCriterion,
          record.evidence,
          true,
          undefined,
          record.status === 'pass'
        );
      }
      check(
        record?.status !== 'adopted' || Boolean(record.limitation),
        `${command.id}: ${classCriterion} adoption lacks an explicit limitation`
      );
      check(record?.status !== 'n/a' || Boolean(record.reason), `${command.id}: ${classCriterion} lacks an N/A reason`);
    }
  }
}

for (const row of verification) {
  check(commandSet.has(row.command), `${row.command}: verification row has no shipped command`);
  check(
    row.live === null || (typeof row.live === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(row.live)),
    `${row.command}: live verification must be an ISO date or null`
  );
  if (row.live) {
    const successfulEvidence = (liveEvidenceByCommand.get(row.command) ?? []).filter(
      ({ provenance }) => provenance.expectedFailure !== true && provenance.outcome !== 'error'
    );
    check(successfulEvidence.length > 0, `${row.command}: dated live verification lacks successful live evidence`);
    const latestRecordedAt = successfulEvidence
      .map(({ provenance }) => provenance.recordedAt)
      .sort()
      .at(-1);
    check(
      latestRecordedAt === row.live,
      `${row.command}: live date ${row.live} does not match latest successful evidence ${latestRecordedAt ?? 'none'}`
    );
  }
}

for (const [command, evidence] of liveEvidenceByCommand) {
  const successfulEvidence = evidence.filter(
    ({ provenance }) => provenance.expectedFailure !== true && provenance.outcome !== 'error'
  );
  if (successfulEvidence.length === 0) continue;
  const row = verification.find((candidate) => candidate.command === command);
  const latestRecordedAt = successfulEvidence
    .map(({ provenance }) => provenance.recordedAt)
    .sort()
    .at(-1);
  check(Boolean(row?.live), `${command}: successful evidence ${latestRecordedAt} is absent from verification`);
}

for (const command of commands.filter(({ id }) =>
  /^data360 (?:docai|retriever|semantic|consent|data-action)(?: |$)/u.test(id)
)) {
  for (const fixturePath of metadata[command.id]?.fixtures ?? []) {
    const fixture = await readJson(`test/${fixturePath.replace(/^test\//u, '')}`);
    check(fixture.__fixture?.source === 'live-scrubbed', `${command.id}: P6 requires a recorded fixture`);
  }
}

for (const absent of [
  'data360 data-space delete',
  'data360 data-space member unset',
  'data360 identity-resolution publish',
  'data360 calculated-insight report',
  'data360 calculated-insight validate',
  'data360 calculated-insight enable',
  'data360 calculated-insight disable',
  'data360 search-index report',
  'data360 metadata search',
]) {
  check(!commandSet.has(absent), `${absent}: unverified command shape must remain absent`);
}

const source = (await readTree(new URL('src/', root))).join('\n');
check(
  !/(?:apiVersion\s*[:=]\s*['"]\d+(?:\.\d+)?['"]|\/services\/data\/v\d+(?:\.\d+)?)/u.test(source),
  'U13 found a hardcoded API version'
);

const continuationMessageFiles = [
  'messages/data360.query.md',
  'messages/data360.ingest.bulk.md',
  'messages/data360.transform.run.md',
  'messages/data360.identity-resolution.run.md',
  'messages/data360.segment.publish.md',
  'messages/data360.data-stream.run.md',
  'messages/data360.data-kit.deploy.md',
  'messages/data360.data-kit.undeploy.md',
];
const continuationCorpus = (
  await Promise.all(continuationMessageFiles.map((path) => readFile(new URL(path, root), 'utf8')))
).join('\n');
for (const continuation of [
  'sf data360 query resume',
  'sf data360 query results',
  'sf data360 ingest resume',
  'sf data360 ingest report',
  'sf data360 transform report',
  'sf data360 identity-resolution get',
  'sf data360 segment get',
  'sf data360 data-stream get',
  'sf data360 data-kit component status',
]) {
  check(continuationCorpus.includes(continuation), `missing copy-paste continuation: ${continuation}`);
  check(commandSet.has(continuation.slice(3)), `continuation targets an absent command: ${continuation}`);
}

if (failures.length > 0) throw new Error(`Release-criteria evaluation failed:\n- ${failures.join('\n- ')}`);
const universalTotals = Array.from({ length: 15 }, (_, offset) => {
  const id = `U${offset + 1}`;
  const values = commands.map(({ id: command }) => criteriaManifest[command].universal[id]);
  const passed = values.filter(({ status }) => status === 'pass').length;
  const skipped = values.filter(({ status }) => status === 'n/a').length;
  return `${id} passed=${passed} n/a=${skipped} failed=${values.length - passed - skipped}`;
});
const classIds = [
  'L1',
  'L2',
  'L3',
  'L4',
  'G1',
  'G2',
  'M1',
  'M2',
  'M3',
  'D1',
  'D2',
  'A1',
  'A2',
  'A3',
  'J1',
  'J2',
  'J3',
  'J4',
  'J5',
  'J6',
];
const classTotals = classIds.map((id) => {
  const values = commands.flatMap(({ id: command }) =>
    criteriaManifest[command].classCriteria[id] ? [criteriaManifest[command].classCriteria[id]] : []
  );
  const passed = values.filter(({ status }) => status === 'pass').length;
  const adopted = values.filter(({ status }) => status === 'adopted').length;
  const skipped = values.filter(({ status }) => status === 'n/a').length;
  return `${id} applicable=${values.length} passed=${passed} adopted=${adopted} n/a=${skipped} failed=${values.length - passed - adopted - skipped}`;
});
process.stdout.write(`PASS command criteria adoption ${commands.length}/${commands.length}\n`);
process.stdout.write(`${universalTotals.join('\n')}\n`);
process.stdout.write(`${classTotals.join('\n')}\n`);
