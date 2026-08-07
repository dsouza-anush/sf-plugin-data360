import { readFile, readdir } from 'node:fs/promises';
import { expect } from 'chai';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import { resolveDataSpace } from '../src/configMeta.js';
import { Data360Command } from '../src/command/Data360Command.js';
import * as requestModule from '../src/client/request.js';
import MetadataList from '../src/commands/data360/metadata/list.js';
import { createCommandTestContext } from './helpers/command.js';
import * as criteria from './helpers/commandCriteria.js';

type Criterion = {
  status: 'pass' | 'adopted' | 'n/a';
  evidence?: string;
  limitation?: string;
  reason?: string;
};
type CriteriaRecord = {
  shape: string;
  requiredFlags: string[];
  optionalFlags: string[];
  flagRelationships: string[];
  schema: string | null;
  fixtures: string[];
  errors: string[];
  statuses: number[];
  classes: string[];
  universal: Record<`U${number}`, Criterion>;
  classCriteria: Record<string, Criterion>;
};
type OclifCommand = {
  flags: Record<
    string,
    { char?: string; description?: string; required?: boolean; summary?: string; type: 'boolean' | 'option' }
  >;
};

const root = new URL('../', import.meta.url);
const normalizedText = async (path: URL): Promise<string> => (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
const readSourceTree = async (directory: URL): Promise<string[]> => {
  const sources: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name, directory);
    if (entry.isDirectory()) sources.push(...(await readSourceTree(new URL(`${entry.name}/`, directory))));
    else if (entry.name.endsWith('.ts')) sources.push(await readFile(path, 'utf8'));
  }
  return sources;
};

class CriteriaData360Command extends Data360Command<unknown> {
  public async run(): Promise<unknown> {
    return Promise.resolve({});
  }

  public writeStatus(message: string): void {
    this.status(message);
  }

  public writeData(message: string): void {
    this.log(message);
  }

  public async initialize<P, C>(options: unknown): Promise<{ parsed: P; connection: C; requestTiming: unknown }> {
    const initializeTiming = (
      this as unknown as {
        initializeTiming: (value: unknown) => Promise<{ parsed: P; connection: C; requestTiming: unknown }>;
      }
    ).initializeTiming;
    return initializeTiming.call(this, options);
  }
}

describe('135-command criteria adoption', () => {
  it('validates generated adoption records and class evidence links', async () => {
    const snapshot = JSON.parse(await readFile(new URL('command-snapshot.json', root), 'utf8')) as {
      commands: Array<{ id: string; summary: string; flags: string[] }>;
    };
    const manifest = JSON.parse(
      await readFile(new URL('test/command-criteria.json', root), 'utf8').catch(() => '{}')
    ) as Record<string, CriteriaRecord>;
    const oclif = JSON.parse(await readFile(new URL('oclif.manifest.json', root), 'utf8')) as {
      commands: Record<string, OclifCommand>;
    };
    const foundationSource = await readFile(new URL('test/foundation.test.ts', root), 'utf8');
    const evaluatorSource = await readFile(new URL('scripts/evaluate-release-criteria.mjs', root), 'utf8');

    expect(Object.keys(manifest)).to.have.length(snapshot.commands.length);
    for (const command of snapshot.commands) {
      const record = manifest[command.id];
      const definition = oclif.commands[command.id.replaceAll(' ', ':')];
      const message = await normalizedText(new URL(`messages/${command.id.replaceAll(' ', '.')}.md`, root));
      const examples = message.match(/<%= config\.bin %> <%= command\.id %>/gu) ?? [];
      const explainedExamples = message.match(/^- .+\n.*<%= config\.bin %> <%= command\.id %>/gmu) ?? [];
      expect(explainedExamples.length, `${command.id} explained examples`).to.be.at.least(2);
      expect(record, command.id).to.exist;
      expect(record.requiredFlags, command.id).to.be.an('array');
      expect(record.optionalFlags, command.id).to.be.an('array');
      expect(record.fixtures, command.id).to.be.an('array').that.is.not.empty;
      expect(record.statuses, command.id).to.include(0);
      for (let index = 1; index <= 15; index += 1) {
        const criterion = record.universal[`U${index}`];
        expect(criterion, `${command.id} U${index}`).to.exist;
        expect(criterion.status, `${command.id} U${index}`).to.be.oneOf(['pass', 'n/a']);
        if (criterion.status === 'pass')
          expect(criterion.evidence, `${command.id} U${index}`).to.be.a('string').and.not.empty;
        else expect(criterion.reason, `${command.id} U${index}`).to.be.a('string').and.not.empty;
      }
      criteria.assertU1({
        summary: command.summary,
        exampleCount: examples.length,
        explainedExampleCount: explainedExamples.length,
        flagsDocumented: command.flags.every((flag) =>
          Boolean(definition.flags[flag]?.summary ?? definition.flags[flag]?.description)
        ),
      });
      const shortCharacters = Object.values(definition.flags)
        .map(({ char }) => char)
        .filter((char): char is string => Boolean(char));
      criteria.assertU4(
        Object.keys(definition.flags),
        shortCharacters.every((char) => /^[a-zA-Z]$/u.test(char)) &&
          new Set(shortCharacters).size === shortCharacters.length
      );
      if (record.universal.U3.status === 'pass') criteria.assertU3(record.flagRelationships.length > 0);
      if (record.universal.U5.status === 'pass') {
        const schema = JSON.parse(await readFile(new URL(record.schema!, root), 'utf8')) as {
          required?: string[];
          properties?: Record<string, unknown>;
        };
        criteria.assertU5({
          envelopeKeys: schema.required ?? [],
          schemaValid: ['status', 'result', 'warnings'].every((key) => key in (schema.properties ?? {})),
        });
      }
      if (record.universal.U11.status === 'pass') {
        expect(record.statuses.slice(0, 3), `${command.id} standard exit codes`).to.deep.equal([0, 1, 2]);
        expect(
          record.statuses.every((code) => [0, 1, 2, 68, 69].includes(code)),
          `${command.id} assigned exit codes`
        ).to.equal(true);
        expect(record.universal.U11.evidence, `${command.id} U11 behavioral evidence`).to.match(/test\/.+\.test\.ts/u);
      }
      if (record.universal.U12.status === 'pass') {
        expect(definition.flags['target-org']?.type, `${command.id} target-org resolver`).to.equal('option');
        expect(record.universal.U12.evidence, `${command.id} U12 behavioral evidence`).to.match(/test\/.+\.test\.ts/u);
      }
      if (record.universal.U13.status === 'pass') {
        expect(definition.flags['api-version'], `${command.id} API version flag`).to.exist;
        expect(evaluatorSource, 'hardcoded API-version audit').to.include('U13 found a hardcoded API version');
      }
      if (record.universal.U14.status === 'pass') {
        expect(definition.flags['data-space'], `${command.id} data-space flag`).to.exist;
        expect(foundationSource).to.include('registers config metadata and resolves data spaces in contract order');
      }
      if (record.universal.U15.status === 'pass') {
        expect(definition.flags.timing?.type, `${command.id} timing flag`).to.equal('boolean');
        expect(foundationSource).to.include('aggregates and formats real timing phases');
        expect(foundationSource).to.include('routes status and selected timing through stubbable stderr UX');
      }
    }
  });

  it('proves U1 help and U4 flag conventions for every command artifact', async () => {
    const snapshot = JSON.parse(await readFile(new URL('command-snapshot.json', root), 'utf8')) as {
      commands: Array<{ id: string; summary: string; flags: string[] }>;
    };
    const oclif = JSON.parse(await readFile(new URL('oclif.manifest.json', root), 'utf8')) as {
      commands: Record<string, OclifCommand>;
    };

    for (const command of snapshot.commands) {
      const definition = oclif.commands[command.id.replaceAll(' ', ':')];
      const message = await normalizedText(new URL(`messages/${command.id.replaceAll(' ', '.')}.md`, root));
      const examples = message.match(/<%= config\.bin %> <%= command\.id %>/gu) ?? [];
      const explainedExamples = message.match(/^- .+\n.*<%= config\.bin %> <%= command\.id %>/gmu) ?? [];
      criteria.assertU1({
        summary: command.summary,
        exampleCount: examples.length,
        explainedExampleCount: explainedExamples.length,
        flagsDocumented: command.flags.every((flag) =>
          Boolean(definition.flags[flag]?.summary ?? definition.flags[flag]?.description)
        ),
      });
      const shortCharacters = Object.values(definition.flags)
        .map(({ char }) => char)
        .filter((char): char is string => Boolean(char));
      criteria.assertU4(
        Object.keys(definition.flags),
        shortCharacters.every((char) => /^[a-zA-Z]$/u.test(char)) &&
          new Set(shortCharacters).size === shortCharacters.length
      );
    }
  });

  it('proves U5 JSON schemas and U11 assigned exit-code matrices for every command', async () => {
    const manifest = JSON.parse(await readFile(new URL('test/command-criteria.json', root), 'utf8')) as Record<
      string,
      CriteriaRecord
    >;
    for (const [id, record] of Object.entries(manifest)) {
      if (record.universal.U5.status === 'pass') {
        const schema = JSON.parse(await readFile(new URL(record.schema!, root), 'utf8')) as {
          required?: string[];
          properties?: Record<string, unknown>;
        };
        criteria.assertU5({
          envelopeKeys: schema.required ?? [],
          schemaValid: ['status', 'result', 'warnings'].every((key) => key in (schema.properties ?? {})),
        });
      }
      criteria.assertU11({
        success: record.statuses[0],
        failure: record.statuses[1],
        parse: record.statuses[2],
        assignedSpecialCodesOnly: record.statuses.every((code) => [0, 1, 2, 68, 69].includes(code)),
      });
      expect(new Set(record.statuses).size, `${id} duplicate exit codes`).to.equal(record.statuses.length);
    }
  });
});

describe('centralized universal criteria behavior', () => {
  const commandTest = createCommandTestContext();

  it('proves U6 U7 and U15 stream and timing invariants through the shared command boundary', async () => {
    const command = Object.create(CriteriaData360Command.prototype) as CriteriaData360Command;
    command.writeStatus('ready');
    command.writeData('row');

    const moments = [0, 4, 4, 10];
    const initialized = await command.initialize<{ flags: { timing: boolean } }, { id: string }>({
      parse: async () => ({ flags: { timing: true } }),
      connect: async () => ({ id: 'connection' }),
      timingSelected: (parsed: { flags: { timing: boolean } }) => parsed.flags.timing,
      now: () => moments.shift()!,
    });
    const requestMoments = [10, 20];
    await requestModule.request<string>(async <T>() => Promise.resolve('ok' as T), {
      method: 'GET',
      url: '/test',
      ...(initialized.requestTiming as object),
      now: () => requestMoments.shift()!,
    } as Parameters<typeof requestModule.request>[1]);

    const stdout = commandTest.ux.log
      .getCalls()
      .map(({ args }) => String(args[0]))
      .join('\n');
    const stderr = commandTest.ux.logToStderr
      .getCalls()
      .map(({ args }) => String(args[0]))
      .join('\n');
    criteria.assertU6(stdout.includes('row'), stderr.includes('ready'));
    criteria.assertU7([stdout, stderr]);
    criteria.assertU15({ stdout, stderr });
  });

  it('proves U12 target-org config default through a real command parser', async () => {
    const org = new MockTestOrgData('criteria-default-org');
    await commandTest.context.stubAuths(org);
    await commandTest.context.stubConfig({ 'target-org': org.username });
    commandTest.context.fakeConnectionRequest = async (): Promise<never> => ({ done: true, metadata: [] }) as never;
    const sfTargetOrg = process.env.SF_TARGET_ORG;
    const sfdxDefaultUsername = process.env.SFDX_DEFAULTUSERNAME;
    delete process.env.SF_TARGET_ORG;
    delete process.env.SFDX_DEFAULTUSERNAME;
    let result: Awaited<ReturnType<typeof MetadataList.run>>;
    try {
      result = await MetadataList.run(['--json']);
    } finally {
      if (sfTargetOrg === undefined) delete process.env.SF_TARGET_ORG;
      else process.env.SF_TARGET_ORG = sfTargetOrg;
      if (sfdxDefaultUsername === undefined) delete process.env.SFDX_DEFAULTUSERNAME;
      else process.env.SFDX_DEFAULTUSERNAME = sfdxDefaultUsername;
    }
    expect(result.entities).to.deep.equal([]);
    criteria.assertU12({ kind: 'default-org', resolved: result.entities.length === 0 });
  });

  it('proves U12 missing target-org default fails cleanly through a real command parser', async () => {
    const sfTargetOrg = process.env.SF_TARGET_ORG;
    const sfdxDefaultUsername = process.env.SFDX_DEFAULTUSERNAME;
    delete process.env.SF_TARGET_ORG;
    delete process.env.SFDX_DEFAULTUSERNAME;
    let missingDefault: unknown;
    try {
      await MetadataList.run(['--json']);
    } catch (error) {
      missingDefault = error;
    } finally {
      if (sfTargetOrg === undefined) delete process.env.SF_TARGET_ORG;
      else process.env.SF_TARGET_ORG = sfTargetOrg;
      if (sfdxDefaultUsername === undefined) delete process.env.SFDX_DEFAULTUSERNAME;
      else process.env.SFDX_DEFAULTUSERNAME = sfdxDefaultUsername;
    }
    criteria.assertU12({ kind: 'missing-default', error: missingDefault as { message?: string; name?: string } });
  });

  it('proves U13 api-version propagation and absence of hardcoded API paths', async () => {
    const org = new MockTestOrgData('criteria-api-version');
    await commandTest.context.stubAuths(org);
    let url = '';
    commandTest.context.fakeConnectionRequest = async (request): Promise<never> => {
      url = String((request as { url?: string }).url);
      return { done: true, metadata: [] } as never;
    };
    await MetadataList.run(['--target-org', org.username, '--api-version', '66.0', '--json']);
    const source = (await readSourceTree(new URL('src/', root))).join('\n');
    criteria.assertU13(url.includes('/services/data/v66.0/ssot/'), /\/services\/data\/v\d+(?:\.\d+)?/u.test(source));
  });

  it('proves U14 data-space precedence through the real resolver', async () => {
    const config = {
      getLocal: (): Promise<string> => Promise.resolve('local'),
      getGlobal: (): Promise<string> => Promise.resolve('global'),
    };
    const observed = [
      await resolveDataSpace({ flagValue: 'flag', env: { SF_DATA360_DATA_SPACE: 'env' }, config }),
      await resolveDataSpace({ env: { SF_DATA360_DATA_SPACE: 'env' }, config }),
      await resolveDataSpace({ env: {}, config }),
      await resolveDataSpace({ env: {}, config: { ...config, getLocal: async () => undefined } }),
      await resolveDataSpace({
        env: {},
        config: { getLocal: async () => undefined, getGlobal: async () => undefined },
      }),
    ];
    criteria.assertU14(observed);
  });
});
