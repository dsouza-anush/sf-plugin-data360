import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { expect } from 'chai';

const root = process.cwd();
const sourceRoot = join(root, 'src');
const commandsRoot = join(sourceRoot, 'commands', 'data360');
const readText = async (path: string): Promise<string> => (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');

const walk = async (directory: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
};

describe('Messages contract', () => {
  it('keeps command metadata and runtime UX out of inline string literals', async () => {
    const prohibited = [
      /public static readonly summary\s*=\s*['"`]/u,
      /\b(?:summary|description):\s*['"`]/u,
      /new (?:SfError|Error)\(\s*['"`]/u,
      /\.(?:status|log|logToStderr|warn|logSuccess)\(\s*['"`]/u,
      /\.confirmDestructive\([^,]+,\s*['"`]/u,
    ];
    const violations: string[] = [];
    for (const file of await walk(sourceRoot)) {
      const source = await readText(file);
      if (prohibited.some((pattern) => pattern.test(source))) violations.push(relative(root, file));
    }
    expect(violations).to.deep.equal([]);
    const config = await readText(join(root, 'eslint.config.js'));
    for (const rule of [
      'sf-plugin/no-hardcoded-messages-commands',
      'sf-plugin/no-hardcoded-messages-flags',
      'sf-plugin/no-missing-messages',
    ])
      expect(config).to.include(`'${rule}': 'error'`);
  });

  it('loads a command message bundle for every shipped command source', async () => {
    const missing: string[] = [];
    for (const file of await walk(commandsRoot)) {
      const source = await readText(file);
      if (!source.includes('loadCommandMessages(') && !source.includes('Messages.loadMessages('))
        missing.push(relative(root, file));
    }
    expect(missing).to.deep.equal([]);
  });

  it('wires descriptions and examples into every shipped command class', async () => {
    const missing: string[] = [];
    for (const file of await walk(commandsRoot)) {
      const source = await readText(file);
      const wired = source.includes('createRegistryCommand(')
        ? source.includes('messages: commandMessages')
        : source.includes("public static readonly description = commandMessages.getMessage('description');") &&
          source.includes("public static readonly examples = commandMessages.getMessages('examples');");
      if (!wired) missing.push(relative(root, file));
    }
    expect(missing).to.deep.equal([]);
  });

  it('keeps complete, user-facing help content in every command message bundle', async () => {
    const violations: string[] = [];
    for (const file of await walk(commandsRoot)) {
      const source = await readText(file);
      const match = /loadCommandMessages\('([^']+)'\)/u.exec(source);
      if (!match) continue;
      const markdown = await readText(join(root, 'messages', `${match[1]}.md`));
      for (const key of ['summary', 'description', 'examples']) {
        const section = new RegExp(`# ${key}\\n\\n([\\s\\S]*?)(?=\\n# |$)`, 'u').exec(markdown)?.[1].trim();
        if (!section) violations.push(`${relative(root, file)} -> ${key}`);
      }
      const examples = /# examples\n\n([\s\S]*?)(?=\n# |$)/u.exec(markdown)?.[1] ?? '';
      if (!examples.includes('<%= config.bin %> <%= command.id %>')) {
        violations.push(`${relative(root, file)} -> examples command template`);
      }
      if (/^ {2}(?!<%= config\.bin %> <%= command\.id %>).*<%= command\.id %>/mu.test(examples)) {
        violations.push(`${relative(root, file)} -> example command does not start with template`);
      }
      for (const [, explanation] of examples.matchAll(/^- (.+)$/gmu)) {
        if (!explanation.endsWith(':')) violations.push(`${relative(root, file)} -> example explanation punctuation`);
      }
      if (/(?:^|\s)-[a-z](?:\s|$)/iu.test(examples)) {
        violations.push(`${relative(root, file)} -> examples use short flags`);
      }
    }
    expect(violations).to.deep.equal([]);
  });

  it('does not ship placeholder flag summaries', async () => {
    const violations: string[] = [];
    for (const entry of await readdir(join(root, 'messages'), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const markdown = await readText(join(root, 'messages', entry.name));
      for (const match of markdown.matchAll(/^# flags\.([^\n]+)\.summary\n\n([^\n]+)/gmu)) {
        if (/^[a-z0-9-]+ option\.$/iu.test(match[2].trim())) {
          violations.push(`${entry.name} -> flags.${match[1]}.summary`);
        }
      }
    }
    expect(violations).to.deep.equal([]);
  });

  it('scopes the sanctioned command inheritance suppression at each explicit leaf', async () => {
    const config = await readText(join(root, 'eslint.config.js'));
    expect(config).to.include("'sf-plugin/only-extend-SfCommand': 'error'");
    expect(config).to.not.include("'sf-plugin/only-extend-SfCommand': 'off'");
    const missing: string[] = [];
    for (const file of await walk(commandsRoot)) {
      const source = await readText(file);
      if (
        source.includes('export default class ') &&
        !source.includes(
          'eslint-disable-next-line sf-plugin/only-extend-SfCommand -- Shared typed command bases centralize Salesforce CLI behavior.'
        )
      )
        missing.push(relative(root, file));
    }
    expect(missing).to.deep.equal([]);
  });

  it('resolves every statically referenced message key', async () => {
    const missing: string[] = [];
    for (const file of await walk(sourceRoot)) {
      const source = await readText(file);
      const bundleMatches = [
        ...source.matchAll(/\b([A-Za-z]+Messages|messages)\s*=\s*loadCommandMessages\('([^']+)'\)/gu),
      ];
      for (const [, variable, bundle] of bundleMatches) {
        const markdown = await readText(join(root, 'messages', `${bundle}.md`));
        const keyPattern = new RegExp(`${variable}\\.getMessage\\('([^']+)'`, 'gu');
        for (const [, key] of source.matchAll(keyPattern)) {
          if (!markdown.includes(`# ${key}\n`)) missing.push(`${relative(root, file)} -> ${bundle}:${key}`);
        }
      }
    }
    expect(missing).to.deep.equal([]);
  });
});
