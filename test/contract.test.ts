import { spawnSync } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import { resolveTestTenantUrl } from '../src/client/testTenantUrl.js';
import { SsotClient } from '../src/client/ssotClient.js';
import { defineResource } from '../src/resources/defineResource.js';
import { registry } from '../src/resources/registry.js';
import { buildApiPath } from '../src/shared/path.js';
import * as criteria from './helpers/commandCriteria.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
type SchemaValidator = ((value: unknown) => boolean) & { errors?: unknown };
const Ajv2020 = require('ajv/dist/2020.js').default as new (options: object) => {
  compile: (schema: object) => SchemaValidator;
};
const packageJson = require('../package.json') as {
  dependencies: Record<string, string>;
  files: string[];
  oclif: { plugins?: string[] };
  scripts: Record<string, string>;
};
const commands = [
  'data360.query',
  'data360.query.resume',
  'data360.query.results',
  'data360.query.cancel',
  'data360.metadata.list',
  'data360.metadata.get',
  'data360.doctor',
  'data360.open',
  'data360.api.request',
];

describe('P1 contracts', () => {
  it('supports SSOT and core transport roots without escaping either root', () => {
    expect(buildApiPath('67.0', '/query-sql', 'ssot')).to.equal('/services/data/v67.0/ssot/query-sql');
    expect(buildApiPath('67.0', '/connect/search/metadata/results', 'core')).to.equal(
      '/services/data/v67.0/connect/search/metadata/results'
    );
    expect(() => buildApiPath('67.0', '../limits', 'ssot')).to.throw('outside the ssot API root');
    for (const endpoint of ['%2e%2e/limits', '%252e%252e/limits', '..%2flimits', '..%5climits', '%zz/limits']) {
      expect(() => buildApiPath('67.0', endpoint, 'ssot'), endpoint).to.throw('outside the ssot API root');
    }
    expect(buildApiPath('67.0', '/query-sql/opaque%2Fid%25value', 'ssot')).to.equal(
      '/services/data/v67.0/ssot/query-sql/opaque%2Fid%25value'
    );
    expect(() => buildApiPath('67.0', '%252e%252e/%25literal', 'ssot')).to.throw('outside the ssot API root');
    expect(() => buildApiPath('67.0', '/services/data/v67.0/ssot/query-sql', 'core')).not.to.throw();
  });

  it('disables jsforce redirects for authenticated Salesforce requests', async () => {
    const observedOptions: unknown[] = [];
    const connection = {
      request: async (_request: unknown, options: unknown): Promise<{ ok: boolean }> => {
        observedOptions.push(options);
        return { ok: true };
      },
    };
    const client = new SsotClient(connection as never, '67.0', { parseMs: 0, connectionMs: 0 });
    expect(await client.get('/metadata')).to.deep.equal({ ok: true });
    expect(
      await client.request({ method: 'POST', endpoint: '/data-streams/example/actions/run', timeoutMs: 120_000 })
    ).to.deep.equal({ ok: true });
    expect(observedOptions).to.deep.equal([{ followRedirect: false }, { followRedirect: false, timeout: 120_000 }]);
  });

  it('restricts the Direct API tenant override to test loopback URLs', () => {
    expect(resolveTestTenantUrl({ NODE_ENV: 'test', SF_DATA360_TENANT_URL: 'http://127.0.0.1:3000' })?.port).to.equal(
      '3000'
    );
    expect(() =>
      resolveTestTenantUrl({ NODE_ENV: 'production', SF_DATA360_TENANT_URL: 'http://127.0.0.1:3000' })
    ).to.throw('restricted to test');
    expect(() =>
      resolveTestTenantUrl({ NODE_ENV: 'test', SF_DATA360_TENANT_URL: 'https://tenant.example.com' })
    ).to.throw('loopback');
  });

  it('preserves per-operation registry overrides', () => {
    const resource = defineResource({
      topic: 'transform',
      base: '/data-transforms' as const,
      nameFields: ['name'],
      columns: ['name'],
      operations: ['list', 'update'] as const,
      operationSpecs: {
        update: { method: 'PUT', queryParams: { validateOnly: false } },
      },
      idKind: { update: 'idOrApiName' },
      pagination: { dialect: 'nextPageUrl' },
    });
    expect(resource.operationSpecs?.update?.method).to.equal('PUT');
    expect(resource.operationSpecs?.update?.queryParams).to.deep.equal({ validateOnly: false });
    expect(resource.pagination?.dialect).to.equal('nextPageUrl');
  });

  it('bounds asynchronous action requests and documents outcome-unknown recovery', () => {
    for (const [topic, action] of [
      ['data-graph', 'refresh'],
      ['data-stream', 'run'],
      ['transform', 'run'],
    ] as const) {
      const specification = registry.get(topic).actions?.[action];
      expect(specification).to.be.an('object');
      expect(specification).to.include({ timeoutMs: 120_000 });
      expect((specification as { outcomeUnknownRecoveryCommand?: string }).outcomeUnknownRecoveryCommand).to.match(
        /^Run sf data360 .+ before retrying\.$/u
      );
    }
  });

  it('ships complete message files and generated schemas', async () => {
    for (const command of commands) {
      const message = await readFile(resolve(root, 'messages', `${command}.md`), 'utf8');
      expect(message).to.include('# summary');
      expect(message).to.include('# description');
      expect(message.match(/<%= config\.bin %> <%= command\.id %>/gu)?.length ?? 0).to.be.at.least(2);
      if (command !== 'data360.api.request') {
        const schemaPath = resolve(root, 'schemas', `${command}.json`);
        await access(schemaPath);
        const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as { $id?: string };
        expect(schema.$id).to.equal(`urn:sf-plugin-data360:schema:${command}`);
      }
    }
  });

  it('marks every JSON fixture with provenance', async () => {
    const fixtureRoot = resolve(root, 'test', 'fixtures');
    const inspect = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) await inspect(path);
        else if (entry.name.endsWith('.json') && entry.name !== 'manifest.json') {
          const fixture = JSON.parse(await readFile(path, 'utf8')) as
            { __fixture?: { source?: string } } | Array<{ __fixture?: { source?: string } }>;
          const provenance = Array.isArray(fixture) ? fixture[0]?.__fixture : fixture.__fixture;
          expect(provenance?.source, path).to.be.oneOf(['live-scrubbed', 'synthetic']);
        }
      }
    };
    await inspect(fixtureRoot);
  });

  it('marks every replayed happy-path fixture with honest provenance', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'test', 'fixtures', 'manifest.json'), 'utf8')) as Array<{
      file: string;
    }>;
    expect(manifest.map(({ file }) => file)).to.have.length.greaterThan(0);
    for (const { file } of manifest) {
      const fixture = JSON.parse(await readFile(resolve(root, 'test', 'fixtures', file), 'utf8')) as {
        synthetic?: boolean;
        __fixture?: { source?: string };
      };
      expect(fixture.__fixture?.source, file).to.be.oneOf(['synthetic', 'live-scrubbed']);
      if (fixture.__fixture?.source === 'synthetic') expect(fixture.synthetic, file).to.equal(true);
      else expect(fixture.synthetic, file).not.to.equal(true);
    }
  });

  it('wires generated artifacts and freshness checks into the build contract', async () => {
    expect(packageJson.scripts).to.include.keys(
      'schemas:generate',
      'snapshot:generate',
      'manifest:generate',
      'criteria:generate',
      'criteria:check',
      'verification:generate',
      'artifacts:check'
    );
    expect(packageJson.scripts.build).to.include('yarn verification:generate');
    expect(packageJson.scripts.build).to.include('yarn criteria:generate');
    expect(packageJson.scripts['contract:check']).to.include('yarn artifacts:check');
    expect(packageJson.scripts['contract:check']).to.include('yarn criteria:check');
    await access(resolve(root, 'scripts', 'normalize-manifest.mjs'));
    await access(resolve(root, 'scripts', 'check-manifest.mjs'));
    expect(packageJson.scripts['manifest:generate']).to.include('oclif manifest');
  });

  it('loads the official Code Extension plugin as a pinned child dependency', async () => {
    expect(packageJson.dependencies['@salesforce/plugin-data-code-extension']).to.equal('1.3.2');
    expect(packageJson.oclif.plugins).to.include('@salesforce/plugin-data-code-extension');
    expect(packageJson.files).to.include('/docs/CODE_EXTENSIONS.md');
    await access(resolve(root, 'docs', 'CODE_EXTENSIONS.md'));
  });

  it('wires the seven release-verification tiers into scripts and non-live CI', async () => {
    expect(packageJson.scripts).to.include.keys(
      'test:t1',
      'test:t2',
      'test:t3',
      'test:t4',
      'test:t5',
      'test:t6',
      'test:t7',
      'test:eval',
      'test:demo',
      'test:coverage',
      'fixtures:scan',
      'secrets:scan',
      'test:package',
      'test:prepush',
      'release:check'
    );
    for (const file of [
      'clean.mjs',
      'evaluate-release-criteria.mjs',
      'demo-e2e.mjs',
      'package-smoke.mjs',
      'pre-push.mjs',
      'public-source-check.mjs',
    ]) {
      await access(resolve(root, 'scripts', file));
    }
    const workflow = await readFile(resolve(root, '.github', 'workflows', 'test.yml'), 'utf8');
    expect(workflow).to.include('yarn test:eval');
    expect(workflow).to.include('yarn test:coverage');
    expect(workflow).to.include('yarn test:package sf-plugin-data360.tgz');
    expect(workflow).to.include('npm install --global @salesforce/cli@2.144.6');
    expect(workflow).to.include('os: [macos-latest, windows-latest]');
    expect(packageJson.scripts['test:coverage']).to.include("--all --include='src/**/*.ts'");
    expect(packageJson.scripts['contract:check']).to.include('yarn fixtures:scan');
    expect(packageJson.scripts['contract:check']).to.include('yarn secrets:scan');
    expect(packageJson.scripts['secrets:scan']).to.equal('node scripts/release-secret-scan.mjs');
    expect(packageJson.files).to.not.include('/scripts/release-secret-scan.mjs');
    await access(resolve(root, 'scripts', 'release-secret-scan.mjs'));
    expect(workflow).to.include('fetch-depth: 0');
    expect(workflow).to.include('yarn secrets:scan');
    expect(packageJson.scripts['test:coverage']).to.include("--exclude='src/commands/**/*.ts'");
    expect(workflow).to.include('yarn test:t2');
    expect(packageJson.scripts['test:t2']).to.include('yarn test:demo');
    expect(workflow).to.include('yarn test:t7');
    expect(workflow).to.not.include('yarn test:t4');
    const liveWorkflow = await readFile(resolve(root, '.github', 'workflows', 'live-nut.yml'), 'utf8');
    expect(liveWorkflow).to.include('yarn test:nuts:live:readonly');
    expect(liveWorkflow).to.not.include('D360_LIVE_MUTATIONS');
    expect(liveWorkflow).to.not.include('D360_LIVE_BILLABLE');
    expect(packageJson.scripts).to.include.keys(
      'test:nuts:live:p2',
      'test:nuts:live:p4',
      'test:nuts:live:p5',
      'test:nuts:live:p6',
      'test:nuts:live:readonly'
    );
    expect(packageJson.scripts['test:nuts:live:readonly']).to.equal('scripts/smoke-readonly.sh');
    const readOnlySmoke = await readFile(resolve(root, 'scripts', 'smoke-readonly.sh'), 'utf8');
    expect(readOnlySmoke).to.include('D360_LIVE_MUTATIONS=0');
    expect(readOnlySmoke).to.include('D360_LIVE_BILLABLE=0');
    expect(readOnlySmoke).to.include('refuses inherited');
    expect(readOnlySmoke).to.match(/if \[\[ "\$\{!gate:-0\}" != "0" \]\]; then/u);
  });

  it('provides one-line U1-U15 helpers and keeps unverified command shapes absent', async () => {
    for (let index = 1; index <= 15; index += 1) {
      expect(criteria).to.have.property(`assertU${index}`).that.is.a('function');
    }
    criteria.assertU1({
      summary: 'List records.',
      exampleCount: 2,
      explainedExampleCount: 2,
      flagsDocumented: true,
    });
    criteria.assertU4(['api-version', 'target-org'], true);
    criteria.assertU10({
      401: 'D360_AUTH_EXPIRED',
      403: 'D360_NOT_PROVISIONED',
      404: 'D360_NOT_FOUND',
      429: 'D360_RATE_LIMITED',
      500: 'D360_API_ERROR',
      direct403: 'D360_SCOPE_MISSING',
    });
    expect(() =>
      criteria.assertU1({
        summary: 'list records',
        exampleCount: 1,
        explainedExampleCount: 0,
        flagsDocumented: false,
      })
    ).to.throw('U1 summary evidence is incomplete');

    const snapshot = JSON.parse(await readFile(resolve(root, 'command-snapshot.json'), 'utf8')) as {
      commands: Array<{ id: string }>;
    };
    const ids = snapshot.commands.map(({ id }) => id);
    for (const absent of [
      'data360 data-space delete',
      'data360 data-space member unset',
      'data360 identity-resolution publish',
      'data360 search-index report',
    ]) {
      expect(ids, absent).to.not.include(absent);
    }
  });

  it('publishes the current command contract without depending on private planning documents', async () => {
    const snapshot = JSON.parse(await readFile(resolve(root, 'command-snapshot.json'), 'utf8')) as {
      commands: Array<{ id: string }>;
    };
    const criteriaManifest = JSON.parse(await readFile(resolve(root, 'test/command-criteria.json'), 'utf8')) as object;
    const contract = await readFile(resolve(root, 'docs/CLI_CONTRACT.md'), 'utf8');
    expect(snapshot.commands).to.have.length(135);
    expect(Object.keys(criteriaManifest)).to.have.length(snapshot.commands.length);
    expect(contract).to.include('command-snapshot.json');
    expect(contract).to.include('yarn test:eval');
    expect(contract).not.to.match(/private (?:plan|review)|internal test plan/iu);
  });

  it('documents every shipped command and keeps curated coverage counts synchronized', async () => {
    const snapshot = JSON.parse(await readFile(resolve(root, 'command-snapshot.json'), 'utf8')) as {
      commands: Array<{ id: string }>;
    };
    const verification = JSON.parse(await readFile(resolve(root, 'test', 'verification.json'), 'utf8')) as Array<{
      command: string;
      live: string | null;
    }>;
    const reference = await readFile(resolve(root, 'docs', 'COMMAND_REFERENCE.md'), 'utf8');
    const readme = await readFile(resolve(root, 'README.md'), 'utf8');
    const gettingStarted = await readFile(resolve(root, 'docs', 'GETTING_STARTED.md'), 'utf8');
    const apiCoverage = await readFile(resolve(root, 'docs', 'API_COVERAGE.md'), 'utf8');
    const liveCount = verification.filter(({ live }) => live !== null).length;

    expect(verification).to.have.length(snapshot.commands.length);
    expect(reference.match(/^## `sf data360(?: [^`]+)?`$/gmu)).to.have.length(snapshot.commands.length);
    for (const { id } of snapshot.commands) {
      expect(reference, id).to.include(`## \`sf ${id}\``);
    }
    expect(readme).to.include(
      `All ${snapshot.commands.length} commands have unit and mocked HTTP coverage; ${liveCount}`
    );
    expect(gettingStarted).to.include(
      `${liveCount} exact commands have successful, scrubbed, checked-in live-org evidence.`
    );
    expect(apiCoverage).to.include(`**${liveCount} of ${snapshot.commands.length}** commands`);
    expect(apiCoverage).to.include(
      `**${snapshot.commands.length} unit/mock; ${liveCount} successful command-specific live fixtures.**`
    );
  });

  it('enforces clean-checkout build and explicit repository hook gates', async () => {
    expect(packageJson.scripts.clean).to.equal('node scripts/clean.mjs');
    expect(packageJson.scripts['prehelp:smoke']).to.include('yarn clean');
    expect(packageJson.scripts['prehelp:smoke']).to.include('yarn compile');
    expect(packageJson.scripts['precontract:check']).to.include('yarn compile');
    expect(packageJson.scripts.prepare).to.equal(undefined);
    expect(packageJson.scripts['hooks:install']).to.equal('node scripts/install-git-hooks.mjs');
    expect(packageJson.files).to.include('/bin');
    expect(packageJson.files).to.not.include('/docs');
    expect(packageJson.files).to.not.include('/LIVE_TESTING.md');
    expect(packageJson.files).to.not.include('/TESTING.md');
    expect(packageJson.files).to.not.include('/scripts/install-git-hooks.mjs');
    expect(packageJson.files).to.not.include('/scripts/audit-openapi-operations.mjs');
    const hook = await readFile(resolve(root, '.githooks', 'pre-push'), 'utf8');
    expect(hook).to.include('node scripts/pre-push.mjs');
    const gateSource = await readFile(resolve(root, 'scripts', 'pre-push.mjs'), 'utf8');
    expect(gateSource).to.include("spawn(yarn, ['run', script]");
    expect(gateSource).to.include("process.platform === 'win32' ? 'yarn.cmd' : 'yarn'");
    for (const gate of [
      'secrets:scan',
      'clean',
      'compile',
      'contract:check',
      'build',
      'help:smoke',
      'lint',
      'format:check',
      'test',
      'test:eval',
      'test:coverage',
      'test:security',
      'test:perf',
      'test:package',
    ]) {
      expect(gateSource).to.include(`'${gate}'`);
    }
    const clean = await readFile(resolve(root, 'scripts', 'clean.mjs'), 'utf8');
    expect(clean).to.include("resolve(root, 'lib')");
    expect(clean).to.include("resolve(root, 'coverage')");
    expect(clean).to.include("endsWith('.tsbuildinfo')");
    const packageSmoke = await readFile(resolve(root, 'scripts', 'package-smoke.mjs'), 'utf8');
    expect(packageSmoke).to.include("import { assertPackageContents } from './package-contents.mjs'");
    expect(packageSmoke).to.include("run(yarn, ['pack', '--filename', tarball])");
    expect(packageSmoke).to.include('npm_config_userconfig: npmUserConfig');
    expect(packageSmoke).to.include("normalized === 'npm_config_before'");
    expect(packageSmoke).to.include("normalized === 'npm_config_min_release_age'");
    expect(packageSmoke).to.include("['plugins', 'trust', 'allowlist', 'add'");
    const packageContents = await readFile(resolve(root, 'scripts', 'package-contents.mjs'), 'utf8');
    expect(packageContents).to.include("'bin/run.js'");
    expect(packageContents).to.include("'internal/'");
    expect(packageContents).to.include("'references/'");
    expect(packageContents).to.include("'LIVE_TESTING.md'");
    const workflow = await readFile(resolve(root, '.github', 'workflows', 'test.yml'), 'utf8');
    expect(workflow.indexOf('yarn clean')).to.be.lessThan(workflow.indexOf('yarn compile'));
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(manifest.scripts?.postpack).to.include('node scripts/sync-oclif-lock.mjs');
  });

  it('keeps the Yarn and packaged oclif dependency locks identical', async () => {
    const yarnLock = await readFile(resolve(root, 'yarn.lock'), 'utf8');
    const oclifLock = await readFile(resolve(root, 'oclif.lock'), 'utf8');
    expect(oclifLock).to.equal(yarnLock);
    const attributes = await readFile(resolve(root, '.gitattributes'), 'utf8');
    expect(attributes).to.include('yarn.lock text eol=lf').and.include('oclif.lock text eol=lf');
  });

  it('binds every live date to successful scrubbed command evidence', async () => {
    const rows = JSON.parse(await readFile(resolve(root, 'test', 'verification.json'), 'utf8')) as Array<{
      command: string;
      live: string | null;
    }>;
    const evidence = new Map<string, string[]>();
    const inspect = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) await inspect(path);
        else if (entry.name.endsWith('.json') && entry.name !== 'manifest.json') {
          const fixture = JSON.parse(await readFile(path, 'utf8')) as
            | {
                __fixture?: {
                  command?: string;
                  expectedFailure?: boolean;
                  outcome?: string;
                  recordedAt?: string;
                  source?: string;
                };
              }
            | Array<{
                __fixture?: {
                  command?: string;
                  expectedFailure?: boolean;
                  outcome?: string;
                  recordedAt?: string;
                  source?: string;
                };
              }>;
          const provenance = Array.isArray(fixture) ? fixture[0]?.__fixture : fixture.__fixture;
          if (
            provenance?.source === 'live-scrubbed' &&
            provenance.command &&
            provenance.recordedAt &&
            provenance.expectedFailure !== true &&
            provenance.outcome !== 'error'
          ) {
            const dates = evidence.get(provenance.command) ?? [];
            dates.push(provenance.recordedAt);
            evidence.set(provenance.command, dates);
          }
        }
      }
    };
    await inspect(resolve(root, 'test', 'fixtures'));
    for (const row of rows) {
      expect(row.live, row.command).to.satisfy(
        (value: unknown) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value))
      );
      const latest = evidence.get(row.command)?.sort().at(-1);
      if (row.live) expect(latest, `${row.command} successful live evidence`).to.equal(row.live);
      if (latest) expect(row.live, `${row.command} verification date`).to.equal(latest);
    }
  });

  it('registers scrubbed successful evidence for the query triad and streaming delete', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'test', 'fixtures', 'manifest.json'), 'utf8')) as Array<{
      liveEvidence?: Array<{ command?: string; file?: string }>;
    }>;
    const cases = [
      ['data360 query results', 'query-results', 'live/query-results.json', '2026-07-11'],
      ['data360 query resume', 'query-resume', 'live/query-resume.json', '2026-07-11'],
      ['data360 query cancel', 'query-cancel', 'live/query-cancel.json', '2026-07-29'],
      ['data360 ingest delete', 'ingest-delete', 'live/ingest-delete.json', '2026-07-11'],
    ] as const;
    const promoted = manifest.flatMap(({ liveEvidence = [] }) =>
      liveEvidence.map(({ command, file }) => `${command}:${file}`)
    );

    expect(promoted).to.include.members(cases.map(([command, , file]) => `${command}:${file}`));

    for (const [command, schemaName, file, recordedAt] of cases) {
      const fixture = JSON.parse(await readFile(resolve(root, 'test', 'fixtures', file), 'utf8')) as {
        __fixture?: { command?: string; outcome?: string; recordedAt?: string; source?: string };
        result?: { queryId?: string; rows?: unknown[] };
        [key: string]: unknown;
      };
      const schema = JSON.parse(
        await readFile(resolve(root, 'schemas', `data360.${schemaName.replace('-', '.')}.json`), 'utf8')
      ) as object;
      const payload = { ...fixture };
      delete payload.__fixture;
      const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

      expect(validate(payload), `${file}: ${JSON.stringify(validate.errors)}`).to.equal(true);
      expect(fixture.__fixture).to.deep.equal({
        source: 'live-scrubbed',
        recordedAt,
        command,
        outcome: 'success',
      });
      expect(JSON.stringify(fixture), `${file}: token-shaped data`).not.to.match(
        /\b(?:access|refresh)[_-]?token\b|00D[A-Za-z0-9]{12,15}!|a360\/(?:prod|test)\//iu
      );
      if (command.startsWith('data360 query ')) {
        expect(fixture.result?.queryId, `${file}: stable scrubbed query ID`).to.equal(
          `LIVE_ID_QUERY_${recordedAt.replaceAll('-', '')}`
        );
        if (command !== 'data360 query cancel')
          expect(fixture.result?.rows, `${file}: minimized query row values`).to.equal(undefined);
      }
    }
  });

  it('publishes a REPL operator checklist without embedding private execution evidence', async () => {
    const checklist = await readFile(resolve(root, 'docs', 'REPL_CHECKLIST.md'), 'utf8');
    for (const item of [
      'real TTY',
      'Press Ctrl-C',
      '`\\f csv`',
      '`\\o /tmp/data360-repl.csv`',
      '`\\timing`',
      '`\\dataspace <known-space>`',
      '`\\dt dmo`',
      '`\\i /tmp/data360-repl.sql` exactly once',
      '`--no-prompt`',
      '`\\last`',
      'exit code 130',
      'exit code 0',
    ]) {
      expect(checklist, item).to.include(item);
    }
    expect(checklist).not.to.match(
      /\b00D[A-Za-z0-9]{12,15}!|a360\/(?:prod|test)\/|force:\/\/|\/secur\/frontdoor\.jsp\?[^\s]*sid=/iu
    );
    expect(checklist).not.to.match(/PASS —|operator:|tested commit:/iu);
  });

  it('verifies commands from explicit test and fixture metadata instead of leaf-word matches', async () => {
    const gate = await readFile(resolve(root, 'scripts', 'verify-command.mjs'), 'utf8');
    expect(gate).to.include('command-metadata.json');
    expect(gate).to.not.include('tests.toLowerCase().includes(leaf.toLowerCase())');
    await access(resolve(root, 'test', 'command-metadata.json'));
  });

  it('records explicit P4 wire contracts and runnable required-flag examples', async () => {
    const metadata = JSON.parse(await readFile(resolve(root, 'test', 'command-metadata.json'), 'utf8')) as Record<
      string,
      { flags: string[]; wire?: { method?: string; path?: string } }
    >;
    for (const [command, entry] of Object.entries(metadata).filter(([id]) =>
      /^data360 (connection|connector|dlo|dmo|mapping|data-stream|transform|data-space)( |$)/u.test(id)
    )) {
      expect(entry.wire?.method, command).to.match(/^(GET|POST|PUT|PATCH|DELETE)$/u);
      expect(entry.wire?.path, command).to.match(/^\//u);
      const message = await readFile(resolve(root, 'messages', `${command.replaceAll(' ', '.')}.md`), 'utf8');
      const examples = message
        .split('\n')
        .map((line) => line.trimStart())
        .filter((line) => line.startsWith('<%= config.bin %>'));
      expect(examples, command).to.have.length.at.least(2);
      if (entry.flags.some((flag) => ['name', 'file', 'relationship-name'].includes(flag))) {
        expect(
          examples.every((line) => /--(?:name|file|relationship-name) /u.test(line)),
          command
        ).to.equal(true);
      }
    }
  });

  it('double-gates the complete live P3 smoke workflow', async () => {
    const smoke = await readFile(resolve(root, 'scripts', 'smoke-p3.sh'), 'utf8');
    expect(smoke).to.include('D360_LIVE_ORG');
    expect(smoke).to.include('D360_LIVE_MUTATIONS');
    expect(smoke).to.include('D360_LIVE_BILLABLE');
    expect(smoke).to.include('data360 ingest validate');
    expect(smoke).to.include('data360 ingest bulk');
    expect(smoke).to.include('data360 ingest ');
    expect(smoke).to.include('data360 query');
  });

  it('rejects P3 live ingestion without the independent mutation acknowledgement', () => {
    const environment: NodeJS.ProcessEnv = { ...process.env, D360_LIVE_ORG: 'test-org' };
    delete environment.D360_LIVE_MUTATIONS;
    const result = spawnSync('bash', [resolve(root, 'scripts', 'smoke-p3.sh')], {
      encoding: 'utf8',
      env: environment,
    });
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('Set D360_LIVE_MUTATIONS=1 after mutation approval.');
  });

  it('keeps the scheduled live smoke runnable and non-billable by default', async () => {
    const workflow = await readFile(resolve(root, '.github', 'workflows', 'live-nut.yml'), 'utf8');
    const smoke = await readFile(resolve(root, 'scripts', 'smoke-p1.sh'), 'utf8');
    expect(workflow).to.include('npm install --global @salesforce/cli@2.144.6');
    expect(workflow).to.include('sf plugins install "$tarball_url"');
    expect(workflow).to.include('sf org login sfdx-url');
    expect(smoke).to.include('D360_LIVE_BILLABLE');
    expect(smoke).to.match(/if \[\[ "\$\{D360_LIVE_BILLABLE:-0\}" == "1" \]\]; then[\s\S]*data360 query/u);
  });

  it('loads P3 command summaries and UX copy from message files', async () => {
    for (const file of [
      'src/commands/data360/ingest.ts',
      'src/commands/data360/ingest/bulk.ts',
      'src/commands/data360/ingest/delete.ts',
      'src/commands/data360/ingest/cancel.ts',
    ]) {
      expect(await readFile(resolve(root, file), 'utf8'), file).to.include('loadCommandMessages');
    }
  });

  it('throws only public error codes registered by COMMANDS', async () => {
    const registered = new Set([
      'D360_API_ERROR',
      'D360_AUTH_EXPIRED',
      'D360_CONFIRMATION_REQUIRED',
      'D360_ECA_CREATE_FAILED',
      'D360_ECA_INVALID_NAME',
      'D360_ECA_OAUTH_FAILED',
      'D360_INVALID_DEFINITION',
      'D360_JOB_FAILED',
      'D360_JOB_TIMEOUT',
      'D360_NAME_AMBIGUOUS',
      'D360_NAME_NOT_FOUND',
      'D360_NOT_FOUND',
      'D360_NOT_PROVISIONED',
      'D360_QUERY_SYNTAX',
      'D360_RATE_LIMITED',
      'D360_SCOPE_MISSING',
      'D360_TOKEN_EXCHANGE_FAILED',
      'D360_UNSUPPORTED_OP',
    ]);
    const codes = new Set<string>();
    const inspect = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) await inspect(path);
        else if (entry.name.endsWith('.ts')) {
          for (const match of (await readFile(path, 'utf8')).matchAll(/['"](D360_[A-Z_]+)['"]/gu)) {
            codes.add(match[1]);
          }
        }
      }
    };
    await inspect(resolve(root, 'src'));
    const environmentControls = new Set(['D360_LIVE_MUTATIONS', 'D360_LIVE_BILLABLE']);
    expect([...codes].filter((code) => !registered.has(code) && !environmentControls.has(code))).to.deep.equal([]);
    expect(codes).to.include('D360_JOB_TIMEOUT');
  });
});
