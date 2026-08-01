import { loadCommandMessages } from '../messages.js';
import { SfError } from '@salesforce/core';

const runtimeMessages = loadCommandMessages('data360.runtime.repl.session');

export type ReplAction =
  | { type: 'continue' }
  | { type: 'quit'; exitCode: number }
  | { type: 'query'; sql: string }
  | { type: 'tables'; entityType?: string }
  | { type: 'describe'; entity: string }
  | { type: 'format'; format: 'human' | 'csv' | 'json' }
  | { type: 'expanded' }
  | { type: 'output'; file?: string }
  | { type: 'dataSpace'; name?: string }
  | { type: 'timing' }
  | { type: 'include'; file: string }
  | { type: 'last' };

export class ReplParser {
  private lines: string[] = [];
  private emptyInterrupt = false;

  public handle(line: string): ReplAction {
    this.emptyInterrupt = false;
    const trimmed = line.trim();
    if (this.lines.length === 0 && trimmed.startsWith('\\')) {
      const [command, argument] = trimmed.split(/\s+/, 2);
      switch (command) {
        case '\\q':
          return { type: 'quit', exitCode: 0 };
        case '\\dt':
          return { type: 'tables', entityType: argument };
        case '\\d':
          if (!argument) throw replError(runtimeMessages.getMessage('error.describe-argument'));
          return { type: 'describe', entity: argument };
        case '\\f':
          if (argument !== 'human' && argument !== 'csv' && argument !== 'json') {
            throw replError(runtimeMessages.getMessage('error.format-argument'));
          }
          return { type: 'format', format: argument };
        case '\\x':
          return { type: 'expanded' };
        case '\\o':
          return { type: 'output', file: argument };
        case '\\dataspace':
          return { type: 'dataSpace', name: argument };
        case '\\timing':
          return { type: 'timing' };
        case '\\i':
          if (!argument) throw replError(runtimeMessages.getMessage('error.include-argument'));
          return { type: 'include', file: argument };
        case '\\last':
          return { type: 'last' };
        default:
          throw replError(runtimeMessages.getMessage('error.unknown-command', [String(command)]));
      }
    }
    this.lines.push(line);
    if (trimmed.endsWith(';')) {
      this.lines[this.lines.length - 1] = line.replace(/;\s*$/u, '');
      const sql = this.lines.join('\n').trim();
      this.lines = [];
      return sql ? { type: 'query', sql } : { type: 'continue' };
    }
    return { type: 'continue' };
  }

  public interrupt(): ReplAction {
    if (this.lines.length > 0) {
      this.lines = [];
      this.emptyInterrupt = false;
      return { type: 'continue' };
    }
    if (this.emptyInterrupt) return { type: 'quit', exitCode: 130 };
    this.emptyInterrupt = true;
    return { type: 'continue' };
  }
}

const replError = (message: string): SfError =>
  new SfError(message, 'D360_API_ERROR', [runtimeMessages.getMessage('error.D360_API_ERROR.0.actions.1')]);
