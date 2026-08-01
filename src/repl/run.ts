import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { loadCommandMessages } from '../messages.js';
import { appendReplHistory, readReplHistory, replHistoryPath } from './history.js';
import { ReplParser, type ReplAction } from './session.js';
import { terminalSafeText } from '../ux/terminal.js';

const messages = loadCommandMessages('data360.runtime.repl.run');

export type ReplFormat = 'human' | 'csv' | 'json';
export type ReplExecutionContext = {
  dataSpace: string;
  expanded: boolean;
  format: ReplFormat;
  outputFile?: string;
  timing: boolean;
};

export type RunReplOptions = {
  dataSpace: string;
  input?: Readable;
  output?: Writable;
  historyPath?: string;
  initialFormat?: ReplFormat;
  initialOutputFile?: string;
  initialTiming?: boolean;
  execute: (sql: string, context: ReplExecutionContext) => Promise<string | undefined>;
  listTables: (entityType: string | undefined, dataSpace: string) => Promise<void>;
  describe: (entity: string, dataSpace: string) => Promise<void>;
};

export const runRepl = async (options: RunReplOptions): Promise<number> => {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const historyPath = options.historyPath ?? replHistoryPath();
  const readline = createInterface({
    input,
    output,
    terminal: Boolean((input as Readable & { isTTY?: boolean }).isTTY),
    history: await readReplHistory(historyPath),
  });
  const parser = new ReplParser();
  let format: ReplFormat = options.initialFormat ?? 'human';
  let dataSpace = options.dataSpace;
  let expanded = false;
  let outputFile = options.initialOutputFile;
  let timing = options.initialTiming ?? false;
  let lastQueryId: string | undefined;
  let exitCode = 0;
  let closed = false;
  readline.once('close', () => {
    closed = true;
  });
  const prompt = (): void => {
    output.write(`${messages.getMessage('prompt', [dataSpace])} `);
  };
  const context = (): ReplExecutionContext => ({ dataSpace, expanded, format, outputFile, timing });
  const act = async (action: ReplAction): Promise<boolean> => {
    switch (action.type) {
      case 'continue':
        return false;
      case 'quit':
        exitCode = action.exitCode;
        readline.close();
        return true;
      case 'query':
        await appendReplHistory(historyPath, action.sql);
        lastQueryId = (await options.execute(action.sql, context())) ?? lastQueryId;
        return false;
      case 'tables':
        await options.listTables(action.entityType, dataSpace);
        return false;
      case 'describe':
        await options.describe(action.entity, dataSpace);
        return false;
      case 'format':
        format = action.format;
        output.write(`${messages.getMessage('format', [format])}\n`);
        return false;
      case 'expanded':
        expanded = !expanded;
        output.write(`${messages.getMessage('expanded', [expanded ? 'on' : 'off'])}\n`);
        return false;
      case 'output':
        outputFile = action.file;
        output.write(
          `${messages.getMessage(outputFile ? 'output-file' : 'output-stdout', outputFile ? [outputFile] : [])}\n`
        );
        return false;
      case 'dataSpace':
        if (action.name) dataSpace = action.name;
        output.write(`${messages.getMessage('data-space', [dataSpace])}\n`);
        return false;
      case 'timing':
        timing = !timing;
        output.write(`${messages.getMessage('timing', [timing ? 'on' : 'off'])}\n`);
        return false;
      case 'include': {
        const sql = await readFile(action.file, 'utf8');
        await appendReplHistory(historyPath, sql.trim());
        lastQueryId = (await options.execute(sql, context())) ?? lastQueryId;
        return false;
      }
      case 'last':
        output.write(
          `${lastQueryId ? messages.getMessage('last', [lastQueryId]) : messages.getMessage('last-empty')}\n`
        );
        return false;
    }
  };
  readline.on('SIGINT', () => {
    void act(parser.interrupt()).then((closed) => {
      if (!closed) prompt();
    });
  });
  prompt();
  for await (const line of readline) {
    try {
      if (await act(parser.handle(line))) break;
    } catch (error) {
      output.write(`${terminalSafeText(error instanceof Error ? error.message : String(error))}\n`);
    }
    if (!closed) prompt();
  }
  return exitCode;
};
