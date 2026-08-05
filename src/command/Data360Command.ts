import { loadCommandMessages } from '../messages.js';
import { performance } from 'node:perf_hooks';
import { SfCommand } from '@salesforce/sf-plugins-core';
import type { TableOptions } from '@oclif/table';
import { SfError } from '@salesforce/core';
import { formatTiming } from '../client/request.js';
import { appendTraceEvent, traceEnabled, traceEnvironment } from '../client/trace.js';
import type { Timing } from '../shared/types.js';
import { terminalSafeText } from '../ux/terminal.js';

const runtimeMessages = loadCommandMessages('data360.runtime.command.Data360Command');

export type InitializeTimingOptions<P, C> = {
  parse: () => Promise<P>;
  connect: (parsed: P) => Promise<C> | C;
  timingSelected: (parsed: P) => boolean;
  now?: () => number;
};

export type InitializedCommand<P, C> = {
  parsed: P;
  connection: C;
  requestTiming: {
    parseMs: number;
    connectionMs: number;
    onTiming?: (timing: Timing) => void;
  };
};

export abstract class Data360Command<T> extends SfCommand<T> {
  public static readonly state = 'beta';

  private timingInitialized = false;
  private traceStartedAt: number | undefined;
  private traceCommandSeq: number | undefined;
  private previousTraceCommandSeq: string | undefined;
  private latestTiming: Timing | undefined;

  public table<R extends Record<string, unknown>>(options: TableOptions<R>): void {
    const data = options.data.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, typeof value === 'string' ? terminalSafeText(value) : value])
      )
    ) as R[];
    const columns = options.columns?.map((column) =>
      typeof column === 'object' && column.name ? { ...column, name: terminalSafeText(column.name) } : column
    );
    super.table({
      ...options,
      data,
      columns,
      ...(options.title ? { title: terminalSafeText(options.title) } : {}),
    });
  }

  protected async init(): Promise<void> {
    await super.init();
    if (!traceEnabled() || process.env.SF_DATA360_TRACE_COMMAND_SEQ !== undefined) return;
    this.traceStartedAt = performance.now();
    this.previousTraceCommandSeq = process.env.SF_DATA360_TRACE_COMMAND_SEQ;
    this.traceCommandSeq = await appendTraceEvent({
      type: 'command.exec',
      command: this.id,
      executable: process.execPath,
      argv: [...(this.id?.split(':') ?? []), ...this.argv],
      cwd: process.cwd(),
      envAllowlist: traceEnvironment(),
    });
    if (this.traceCommandSeq !== undefined) process.env.SF_DATA360_TRACE_COMMAND_SEQ = String(this.traceCommandSeq);
  }

  protected async finally(error: Error | undefined): Promise<unknown> {
    try {
      if (this.traceCommandSeq !== undefined) {
        const exitCode =
          (error as (Error & { exitCode?: number }) | undefined)?.exitCode ??
          (typeof process.exitCode === 'number' ? process.exitCode : 0);
        await appendTraceEvent({
          type: 'command.result',
          seqRef: this.traceCommandSeq,
          exitCode,
          durationMs: Math.max(0, performance.now() - (this.traceStartedAt ?? performance.now())),
          ...(this.latestTiming
            ? {
                timing: {
                  parseMs: this.latestTiming.parseMs,
                  connMs: this.latestTiming.connectionMs,
                  reqMs: this.latestTiming.requestMs,
                  totalMs: this.latestTiming.totalMs,
                },
              }
            : {}),
        });
      }
    } finally {
      if (this.traceCommandSeq !== undefined) {
        if (this.previousTraceCommandSeq === undefined) delete process.env.SF_DATA360_TRACE_COMMAND_SEQ;
        else process.env.SF_DATA360_TRACE_COMMAND_SEQ = this.previousTraceCommandSeq;
      }
    }
    return super.finally(error);
  }

  protected status(message: string): void {
    this.logToStderr(message);
  }

  protected async confirmDestructive(noPrompt: boolean, message: string): Promise<void> {
    if (noPrompt) return;
    if (this.jsonEnabled() || !process.stdin.isTTY || !process.stdout.isTTY) {
      throw new SfError(
        runtimeMessages.getMessage('error.D360_CONFIRMATION_REQUIRED.1'),
        'D360_CONFIRMATION_REQUIRED',
        [runtimeMessages.getMessage('error.D360_CONFIRMATION_REQUIRED.1.actions.1')]
      );
    }
    if (!(await this.confirm({ message, defaultAnswer: false, ms: 10_000 }))) {
      throw new SfError(
        runtimeMessages.getMessage('error.D360_CONFIRMATION_REQUIRED.2'),
        'D360_CONFIRMATION_REQUIRED',
        [runtimeMessages.getMessage('error.D360_CONFIRMATION_REQUIRED.2.actions.1')]
      );
    }
  }

  protected async initializeTiming<P, C>(options: InitializeTimingOptions<P, C>): Promise<InitializedCommand<P, C>> {
    if (this.timingInitialized) throw new Error(runtimeMessages.getMessage('error.RUNTIME_3.3'));
    this.timingInitialized = true;

    const now = options.now ?? performance.now.bind(performance);
    const parseStart = now();
    const parsed = await options.parse();
    const parseMs = now() - parseStart;

    const connectionStart = now();
    const connection = await options.connect(parsed);
    const connectionMs = now() - connectionStart;
    const timingEnabled = options.timingSelected(parsed);

    return {
      parsed,
      connection,
      requestTiming: {
        parseMs,
        connectionMs,
        onTiming:
          timingEnabled || traceEnabled()
            ? (timing: Timing): void => {
                this.latestTiming = timing;
                if (timingEnabled) this.logToStderr(formatTiming(timing));
              }
            : undefined,
      },
    };
  }
}
