import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'chai';

type Finding = { label: string; line: number; path?: string; source?: string };
type Scanner = {
  findSensitiveValues: (contents: string) => Finding[];
  formatFindings: (findings: Finding[]) => string;
  scanRepository: (options: { gitBinary?: string; ref?: string; root: string }) => Promise<{
    findings: Finding[];
    historicalBlobs: number;
    indexBlobs: number;
    ref: string;
    workingTreeFiles: number;
  }>;
};

const root = resolve(import.meta.dirname, '..');
const loadScanner = async (): Promise<Scanner> =>
  import(pathToFileURL(resolve(root, 'scripts', 'release-secret-scan.mjs')).href) as Promise<Scanner>;

const git = (directory: string, ...args: string[]): void => {
  const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Test Git command failed: git ${args[0] ?? ''}`);
};

const initializeRepository = async (): Promise<string> => {
  const directory = await mkdtemp(resolve(tmpdir(), 'd360-release-secret-scan-'));
  git(directory, 'init');
  git(directory, 'config', 'user.email', 'release-scan@example.invalid');
  git(directory, 'config', 'user.name', 'Release Scan Test');
  return directory;
};

describe('release secret scan', () => {
  it('scrubs the complete Salesforce session alphabet before fixture output', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-fixture-scrub-'));
    const source = resolve(directory, 'raw.json');
    const session = `${'00D'}A1b2C3d4E5f6G7H!A+opaque/session=value`;
    await writeFile(source, `${JSON.stringify({ detail: `upstream returned ${session}` })}\n`);
    try {
      const result = spawnSync(process.execPath, [resolve(root, 'scripts', 'scrub-fixture.mjs'), source], {
        encoding: 'utf8',
      });
      expect(result.status).to.equal(0);
      expect(result.stdout).to.include('REDACTED_ACCESS_TOKEN');
      expect(result.stdout).not.to.include('opaque/session=value');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('detects Salesforce and Data 360 credential shapes without returning their values', async () => {
    const { findSensitiveValues, formatFindings } = await loadScanner();
    const tenantId = ['a360', 'prod', 'fedcba98765432100123456789abcdef'].join('/');
    const accessToken = `${'00D'}A1b2C3d4E5f6G7H!opaqueSessionValue`;
    const username = ['person', 'internal.corp'].join('@');
    const orgUrl = ['https://release-candidate', 'my', 'salesforce', 'com'].join('.');
    const authUrl = ['force', '://client:client-secret:refresh-token', '@', 'login.salesforce.com'].join('');
    const orgId = `${'00D'}A1b2C3d4E5f6`;
    const userId = `${'005'}A1b2C3d4E5f6G7H`;
    const clientSecret = `${['CLIENT', 'SECRET'].join('_')}=${['opaque', 'release', 'credential'].join('-')}`;
    const contents = [
      tenantId,
      accessToken,
      username,
      orgUrl,
      authUrl,
      `datacloudflow__SalesforceDotCom_${orgId}`,
      userId,
      clientSecret,
    ].join('\n');

    const findings = findSensitiveValues(contents);
    expect(findings.map(({ label }) => label)).to.include.members([
      'Data 360 tenant identifier',
      'Salesforce access token or session ID',
      'email address or Salesforce username',
      'Salesforce org hostname',
      'Salesforce auth URL',
      'Salesforce org ID',
      'Salesforce user ID',
      'credential-valued field',
    ]);
    expect(JSON.stringify(findings))
      .to.not.include(tenantId)
      .and.not.include(accessToken)
      .and.not.include(username)
      .and.not.include(orgId)
      .and.not.include(clientSecret);
    const sanitizedLocation = formatFindings([
      { label: 'Data 360 tenant identifier', line: 1, path: tenantId, source: 'working tree' },
    ]);
    expect(sanitizedLocation).to.include('credential-shaped filename omitted').and.not.include(tenantId);
  });

  it('detects encoded frontdoor OTP sessions and scans untracked files', async () => {
    const directory = await initializeRepository();
    try {
      await writeFile(resolve(directory, 'safe.txt'), 'safe=true\n');
      git(directory, 'add', 'safe.txt');
      git(directory, 'commit', '-m', 'safe baseline');

      const encodedSession = `${'00D'}A1b2C3d4E5f6G7H%21opaqueSessionValue`;
      const orgUrl = ['https://release-candidate', 'my', 'salesforce', 'com'].join('.');
      const frontdoor = `${orgUrl}/secur/frontdoor.jsp?otp=${encodedSession}`;
      await writeFile(resolve(directory, 'untracked-capture.txt'), `${frontdoor}\n`);

      const { formatFindings, scanRepository } = await loadScanner();
      const result = await scanRepository({ root: directory, ref: 'HEAD' });
      expect(result.findings).to.deep.include({
        label: 'Salesforce frontdoor session URL',
        line: 1,
        path: 'untracked-capture.txt',
        source: 'working tree',
      });
      expect(result.findings.some(({ label }) => label === 'Salesforce access token or session ID')).to.equal(true);
      expect(formatFindings(result.findings)).to.not.include(encodedSession);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('allows only explicit test and documentation placeholders', async () => {
    const { findSensitiveValues } = await loadScanner();
    const placeholders = [
      'user@example.invalid',
      'https://tenant.c360a.salesforce.com',
      'Bearer tenant-jwt-secret',
      'force://<client-id>:<client-secret>:<refresh-token>@login.salesforce.com',
      '00D000000000001',
      '005000000000001',
      'client_secret=<client-secret>',
    ].join('\n');

    expect(findSensitiveValues(placeholders)).to.deep.equal([]);
  });

  it('detects encrypted PKCS8 private-key markers', async () => {
    const { findSensitiveValues } = await loadScanner();
    const marker = ['-----BEGIN ENCRYPTED ', 'PRIVATE KEY-----'].join('');
    expect(findSensitiveValues(marker).map(({ label }) => label)).to.include('private key');
  });

  it('allows line-scoped synthetic corpus markers only in reviewed test files', async () => {
    const directory = await initializeRepository();
    try {
      const credential = ['opaque', 'fixture', 'credential'].join('-');
      const field = ['client', 'secret'].join('_');
      const fixturePath = resolve(directory, 'test', 'trace.test.ts');
      await mkdir(resolve(directory, 'test'), { recursive: true });
      await writeFile(fixturePath, `const ${field} = "${credential}"; // secret-scan: synthetic-fixture\n`);
      git(directory, 'add', 'test/trace.test.ts');
      git(directory, 'commit', '-m', 'synthetic redaction corpus');

      const { scanRepository } = await loadScanner();
      expect((await scanRepository({ root: directory, ref: 'HEAD' })).findings).to.deep.equal([]);

      await writeFile(fixturePath, `const ${field} = "${credential}";\n`);
      const unmarked = await scanRepository({ root: directory, ref: 'HEAD' });
      expect(unmarked.findings).to.deep.include({
        label: 'credential-valued field',
        line: 1,
        path: 'test/trace.test.ts',
        source: 'working tree',
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('scans tracked working-tree changes independently of committed history', async () => {
    const directory = await initializeRepository();
    try {
      await writeFile(resolve(directory, 'configuration.txt'), 'safe=true\n');
      git(directory, 'add', 'configuration.txt');
      git(directory, 'commit', '-m', 'safe baseline');

      const tenantId = ['a360', 'test', 'abcdefabcdefabcdefabcdefabcdefab'].join('/');
      await writeFile(resolve(directory, 'configuration.txt'), `tenant=${tenantId}\n`);

      const { formatFindings, scanRepository } = await loadScanner();
      const result = await scanRepository({ root: directory, ref: 'HEAD' });
      expect(result.findings).to.deep.include({
        label: 'Data 360 tenant identifier',
        line: 1,
        path: 'configuration.txt',
        source: 'working tree',
      });
      expect(formatFindings(result.findings)).to.not.include(tenantId);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('scans staged blobs even when the working-tree copy has been cleaned', async () => {
    const directory = await initializeRepository();
    try {
      await writeFile(resolve(directory, 'configuration.txt'), 'tenant=[REDACTED]\n');
      git(directory, 'add', 'configuration.txt');
      git(directory, 'commit', '-m', 'safe baseline');

      const tenantId = ['a360', 'test', '1234567890abcdef1234567890abcdef'].join('/');
      await writeFile(resolve(directory, 'configuration.txt'), `tenant=${tenantId}\n`);
      git(directory, 'add', 'configuration.txt');
      await writeFile(resolve(directory, 'configuration.txt'), 'tenant=[REDACTED]\n');

      const { formatFindings, scanRepository } = await loadScanner();
      const result = await scanRepository({ root: directory, ref: 'HEAD' });
      expect(result.findings).to.deep.include({
        label: 'Data 360 tenant identifier',
        line: 1,
        path: 'configuration.txt',
        source: 'Git index',
      });
      expect(result.findings.some(({ source }) => source === 'working tree')).to.equal(false);
      expect(formatFindings(result.findings)).to.not.include(tenantId);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('finds a removed credential in every blob reachable from the selected ref', async () => {
    const directory = await initializeRepository();
    try {
      const tenantId = ['a360', 'prod', 'abcdef0123456789abcdef0123456789'].join('/');
      await writeFile(resolve(directory, 'release.txt'), `tenant=${tenantId}\n`);
      git(directory, 'add', 'release.txt');
      git(directory, 'commit', '-m', 'historical release data');
      await writeFile(resolve(directory, 'release.txt'), 'tenant=[REDACTED]\n');
      git(directory, 'add', 'release.txt');
      git(directory, 'commit', '-m', 'remove release data');

      const { formatFindings, scanRepository } = await loadScanner();
      const result = await scanRepository({ root: directory, ref: 'HEAD' });
      expect(
        result.findings.some(({ path, source }) => path === 'release.txt' && source === 'reachable history')
      ).to.equal(true);
      expect(result.findings.some(({ source }) => source === 'working tree')).to.equal(false);
      expect(formatFindings(result.findings)).to.not.include(tenantId);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('fails closed when Git cannot enumerate the repository', async () => {
    const directory = await initializeRepository();
    try {
      const { scanRepository } = await loadScanner();
      let error: unknown;
      try {
        await scanRepository({ gitBinary: 'git-binary-that-does-not-exist', root: directory });
      } catch (caught) {
        error = caught;
      }
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.equal(
        'Release secret scan could not run Git during tracked-file enumeration.'
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
