import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'chai';

type PublicSourceChecker = {
  checkPublicSource: (options: { root: string; historyRef?: string }) => Promise<{ violations: string[] }>;
};

const loadChecker = async (): Promise<PublicSourceChecker> =>
  import(
    pathToFileURL(resolve(import.meta.dirname, '..', 'scripts', 'public-source-check.mjs')).href
  ) as Promise<PublicSourceChecker>;

const git = (root: string, ...args: string[]): void => {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
};

const repository = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'data360-public-source-'));
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'Public Source Test');
  await writeFile(join(root, '.gitignore'), 'internal/\n');
  await writeFile(join(root, '.npmignore'), '/internal/\n');
  await writeFile(join(root, 'README.md'), '# Public fixture\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'initial');
  return root;
};

describe('public source boundary', () => {
  it('allows ignored restricted material and rejects reserved public paths', async () => {
    const root = await repository();
    try {
      const { checkPublicSource } = await loadChecker();
      await mkdir(join(root, 'internal'));
      await writeFile(join(root, 'internal', 'notes.md'), 'restricted fixture\n');
      expect((await checkPublicSource({ root })).violations).to.deep.equal([]);

      await mkdir(join(root, 'docs'));
      await writeFile(join(root, 'docs', 'PLAN.md'), '# Restricted fixture\n');
      expect((await checkPublicSource({ root })).violations.join('\n')).to.include('docs/PLAN.md');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('detects a reserved path that was deleted from the release commit', async () => {
    const root = await repository();
    try {
      const { checkPublicSource } = await loadChecker();
      await mkdir(join(root, 'docs'));
      await writeFile(join(root, 'docs', 'PLAN.md'), '# Historical restricted fixture\n');
      git(root, 'add', '.');
      git(root, 'commit', '--quiet', '-m', 'add restricted fixture');
      git(root, 'rm', '--quiet', 'docs/PLAN.md');
      git(root, 'commit', '--quiet', '-m', 'remove restricted fixture');

      expect((await checkPublicSource({ root })).violations).to.deep.equal([]);
      expect((await checkPublicSource({ root, historyRef: 'HEAD' })).violations.join('\n')).to.include(
        'HEAD:docs/PLAN.md'
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('inspects staged bytes even when the working tree contains different safe bytes', async () => {
    const root = await repository();
    try {
      const { checkPublicSource } = await loadChecker();
      const privateReference = ['#platform', 'cli', 'collaboration'].join('-');
      await writeFile(join(root, 'README.md'), `Coordinate in ${privateReference}.\n`);
      git(root, 'add', 'README.md');
      await writeFile(join(root, 'README.md'), '# Public fixture\n');

      expect((await checkPublicSource({ root })).violations.join('\n')).to.include(
        'index:README.md: named internal collaboration reference'
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('detects private collaboration references previously stored at a public path', async () => {
    const root = await repository();
    try {
      const { checkPublicSource } = await loadChecker();
      const privateReference = ['#platform', 'cli', 'collaboration'].join('-');
      await writeFile(join(root, 'README.md'), `Coordinate in ${privateReference}.\n`);
      git(root, 'add', '.');
      git(root, 'commit', '--quiet', '-m', 'add restricted reference');
      await writeFile(join(root, 'README.md'), '# Public fixture\n');
      git(root, 'add', '.');
      git(root, 'commit', '--quiet', '-m', 'remove restricted reference');

      expect((await checkPublicSource({ root })).violations).to.deep.equal([]);
      expect((await checkPublicSource({ root, historyRef: 'HEAD' })).violations.join('\n')).to.include(
        'HEAD:README.md: named internal collaboration reference'
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects internal repository hostnames', async () => {
    const root = await repository();
    try {
      const { checkPublicSource } = await loadChecker();
      const internalHost = ['git', 'soma', 'salesforce', 'com'].join('.');
      await writeFile(join(root, 'package.json'), `{"repository":"https://${internalHost}/example/project"}\n`);
      expect((await checkPublicSource({ root })).violations.join('\n')).to.include(
        'package.json: internal repository hostname'
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('allows domain field labels while rejecting a private publication directive', async () => {
    const root = await repository();
    try {
      const { checkPublicSource } = await loadChecker();
      await writeFile(join(root, 'fixture.json'), '{"label":"Is Internal Only","name":"IsInternalOnly__c"}\n');
      expect((await checkPublicSource({ root })).violations).to.deep.equal([]);

      const directive = ['internal', 'only content'].join('-');
      const label = ['internal', 'only directive'].join('-');
      await writeFile(join(root, 'README.md'), `This file contains ${directive}.\n`);
      expect((await checkPublicSource({ root })).violations.join('\n')).to.include(`README.md: ${label}`);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
