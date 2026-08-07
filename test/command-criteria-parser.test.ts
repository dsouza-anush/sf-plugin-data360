import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import { MockTestOrgData } from '@salesforce/core/testSetup';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { createCommandTestContext } from './helpers/command.js';
import * as commandCriteria from './helpers/commandCriteria.js';

const root = new URL('../', import.meta.url);
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'];

describe('criteria parser evidence', () => {
  const commandTest = createCommandTestContext();

  it('rejects unknown flags for every shipped command through the actual oclif parser', async function () {
    // Importing and parsing every shipped command takes ~28s on the release
    // runner, so leave enough headroom for a warm full-suite process.
    this.timeout(180_000);
    const org = new MockTestOrgData('criteria-unknown');
    await commandTest.context.stubAuths(org);
    await commandTest.context.stubConfig({ 'target-org': org.username });
    const manifest = JSON.parse(await readFile(new URL('test/command-criteria.json', root), 'utf8')) as Record<
      string,
      { requiredFlags: string[]; optionalFlags: string[]; schema: string | null }
    >;
    const stderrWrite = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      for (const [id, criteria] of Object.entries(manifest)) {
        const listeners = new Map(signals.map((signal) => [signal, process.listeners(signal)]));
        const source = new URL(`src/commands/${id.split(' ').join('/')}.ts`, root);
        const module = (await import(source.href)) as { default: { run: (argv: string[]) => Promise<unknown> } };
        let error: unknown;
        try {
          await module.default.run(['--criteria-unknown-flag']);
        } catch (caught) {
          error = caught;
        } finally {
          for (const signal of signals) {
            const original = listeners.get(signal) ?? [];
            for (const listener of process.listeners(signal)) {
              if (!original.includes(listener)) process.removeListener(signal, listener);
            }
          }
        }
        const exit = (error as { oclif?: { exit?: number } })?.oclif?.exit;
        expect(exit, id).to.equal(2);
        commandCriteria.assertU2({ kind: 'unknown-flag', exit: exit! });
        expect([...criteria.requiredFlags, ...criteria.optionalFlags], id).to.include('flags-dir');
        if (criteria.schema) expect([...criteria.requiredFlags, ...criteria.optionalFlags], id).to.include('json');
      }
    } finally {
      process.stderr.write = stderrWrite;
    }
  });

  it('rejects every omitted non-org required flag through the actual oclif parser', async function () {
    this.timeout(180_000);
    const criteria = JSON.parse(await readFile(new URL('test/command-criteria.json', root), 'utf8')) as Record<
      string,
      { requiredFlags: string[] }
    >;
    const oclif = JSON.parse(await readFile(new URL('oclif.manifest.json', root), 'utf8')) as {
      commands: Record<
        string,
        {
          flags: Record<string, { options?: string[]; type: 'boolean' | 'option' }>;
        }
      >;
    };
    const directory = await mkdtemp(join(tmpdir(), 'criteria-required-'));
    const file = join(directory, 'input.json');
    await writeFile(file, '{}');
    const org = new MockTestOrgData('criteria-required');
    await commandTest.context.stubAuths(org);
    const confirm = commandTest.context.SANDBOX.stub(SfCommand.prototype as never, 'confirm').resolves(true);
    const valueFor = (flag: string, definition: { options?: string[] }): string => {
      if (flag === 'target-org') return org.username;
      if (['file', 'definition-file', 'query-options-file'].includes(flag)) return file;
      return definition.options?.[0] ?? `Fixture_${flag.replaceAll('-', '_')}`;
    };
    const stderrWrite = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      for (const [id, record] of Object.entries(criteria)) {
        const definition = oclif.commands[id.replaceAll(' ', ':')];
        const explicitlyRequired = record.requiredFlags.filter((flag) => flag !== 'target-org');
        for (const omitted of explicitlyRequired) {
          const listeners = new Map(signals.map((signal) => [signal, process.listeners(signal)]));
          const argv: string[] = [];
          for (const flag of record.requiredFlags.filter((candidate) => candidate !== omitted)) {
            const flagDefinition = definition.flags[flag];
            argv.push(`--${flag}`);
            if (flagDefinition.type !== 'boolean') argv.push(valueFor(flag, flagDefinition));
          }
          const source = new URL(`src/commands/${id.split(' ').join('/')}.ts`, root);
          const module = (await import(source.href)) as { default: { run: (argv: string[]) => Promise<unknown> } };
          confirm.resetHistory();
          let error: unknown;
          try {
            await module.default.run(argv);
          } catch (caught) {
            error = caught;
          } finally {
            for (const signal of signals) {
              const original = listeners.get(signal) ?? [];
              for (const listener of process.listeners(signal)) {
                if (!original.includes(listener)) process.removeListener(signal, listener);
              }
            }
          }
          const exit = (error as { oclif?: { exit?: number } })?.oclif?.exit;
          expect(exit, `${id}: --${omitted}`).to.equal(2);
          commandCriteria.assertU2({
            kind: 'missing-required',
            exit: exit!,
            flag: omitted,
            message: (error as Error).message,
            prompted: confirm.called,
          });
        }
      }
    } finally {
      process.stderr.write = stderrWrite;
    }
  });
});

describe('criteria relationship evidence', () => {
  const commandTest = createCommandTestContext();
  it('enforces every declared exclusive and dependent flag relationship', async function () {
    this.timeout(30_000);
    const criteria = JSON.parse(await readFile(new URL('test/command-criteria.json', root), 'utf8')) as Record<
      string,
      { flagRelationships: string[]; requiredFlags: string[] }
    >;
    const oclif = JSON.parse(await readFile(new URL('oclif.manifest.json', root), 'utf8')) as {
      commands: Record<string, { flags: Record<string, { type: 'boolean' | 'option' }> }>;
    };
    const directory = await mkdtemp(join(tmpdir(), 'criteria-parser-'));
    const file = join(directory, 'input.json');
    await writeFile(file, '{}');
    const org = new MockTestOrgData('criteria-parser');
    await commandTest.context.stubAuths(org);
    const optionValues = new Map([
      ['result-format', 'human'],
      ['method', 'GET'],
      ['operation', 'upsert'],
      ['wait', '1'],
    ]);
    const valueFor = (flag: string): string =>
      flag === 'target-org'
        ? org.username
        : ['file', 'definition-file'].includes(flag)
          ? file
          : (optionValues.get(flag) ?? '1');
    const appendFlag = (argv: string[], flag: string, definition: { type: 'boolean' | 'option' }): void => {
      argv.push(`--${flag}`);
      if (definition.type !== 'boolean') argv.push(valueFor(flag));
    };

    for (const [id, record] of Object.entries(criteria).filter(([, value]) => value.flagRelationships.length > 0)) {
      const definition = oclif.commands[id.replaceAll(' ', ':')];
      const source = new URL(`src/commands/${id.split(' ').join('/')}.ts`, root);
      const module = (await import(source.href)) as { default: { run: (argv: string[]) => Promise<unknown> } };
      for (const relationship of record.flagRelationships) {
        const listeners = new Map(signals.map((signal) => [signal, process.listeners(signal)]));
        const match = relationship.match(/^(.+) (excludes|depends on) (.+)$/u);
        expect(match, `${id}: ${relationship}`).to.not.equal(null);
        const [, left, kind, right] = match!;
        const selected = kind === 'excludes' ? new Set([left, right]) : new Set([left]);
        const argv: string[] = [];
        for (const flag of new Set([...record.requiredFlags, ...selected])) {
          if (kind === 'depends on' && flag === right) continue;
          appendFlag(argv, flag, definition.flags[flag]);
        }
        let error: unknown;
        try {
          await module.default.run(argv);
        } catch (caught) {
          error = caught;
        } finally {
          for (const signal of signals) {
            const original = listeners.get(signal) ?? [];
            for (const listener of process.listeners(signal)) {
              if (!original.includes(listener)) process.removeListener(signal, listener);
            }
          }
        }
        expect((error as { oclif?: { exit?: number } })?.oclif?.exit, `${id}: ${relationship}`).to.equal(2);
        expect((error as Error).message, `${id}: ${relationship}`).to.include(`--${left}`);
        commandCriteria.assertU3((error as Error).message.includes(`--${left}`));
      }
    }
  });
});
