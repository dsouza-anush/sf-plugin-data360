import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect } from 'chai';

type LedgerModule = {
  buildCompletionLedger: (input: {
    inventory: Array<{ id: string }>;
    verification: Array<{ command: string; live: string | null }>;
    invocations: Map<
      string,
      {
        timestamp: string;
        date: string;
        session: string;
        sequence: number;
        exitCode: number | null;
        sessionSchemaValid: boolean;
      }
    >;
    errorEvidence: Map<string, { date: string; code: string | null }>;
    pendingCommands: string[];
    generatedAt: string;
  }) => {
    summary: Record<string, number>;
    commands: Array<Record<string, unknown>>;
  };
  loadLatestInvocations: (directory: string) => Promise<
    Map<
      string,
      {
        timestamp: string;
        date: string;
        session: string;
        sequence: number;
        exitCode: number | null;
        sessionSchemaValid: boolean;
      }
    >
  >;
};

describe('live completion ledger', () => {
  it('separates exact success, expected-contract, and credit-gated evidence without org data', async () => {
    // @ts-expect-error -- The source-only ledger generator is intentionally plain ESM JavaScript.
    const { buildCompletionLedger } = (await import('../scripts/build-live-completion-ledger.mjs')) as LedgerModule;
    const ledger = buildCompletionLedger({
      inventory: [{ id: 'data360 doctor' }, { id: 'data360 transform create' }, { id: 'data360 transform run' }],
      verification: [
        { command: 'data360 doctor', live: '2026-07-26' },
        { command: 'data360 transform create', live: null },
        { command: 'data360 transform run', live: '2026-07-19' },
      ],
      invocations: new Map([
        [
          'data360 doctor',
          {
            timestamp: '2026-07-26T00:00:00.000Z',
            date: '2026-07-26',
            session: 'session-safe',
            sequence: 1,
            exitCode: 0,
            sessionSchemaValid: true,
          },
        ],
        [
          'data360 transform create',
          {
            timestamp: '2026-07-26T00:01:00.000Z',
            date: '2026-07-26',
            session: 'session-safe',
            sequence: 2,
            exitCode: 1,
            sessionSchemaValid: true,
          },
        ],
      ]),
      errorEvidence: new Map([['data360 transform create', { date: '2026-07-26', code: 'D360_INVALID_DEFINITION' }]]),
      pendingCommands: ['data360 transform run'],
      generatedAt: '2026-07-26T00:02:00.000Z',
    });

    expect(ledger.summary).to.deep.equal({
      inventory: 3,
      invoked: 2,
      liveSuccess: 1,
      liveFailure: 0,
      contractObserved: 1,
      creditGated: 1,
      notInvoked: 0,
      unvalidatedTraceObservations: 0,
    });
    expect(ledger.commands[1]).to.include({
      state: 'contract_observed',
      blockerCategory: 'invalid_definition_contract',
      contractCode: 'D360_INVALID_DEFINITION',
      evidenceDate: '2026-07-26',
    });
    expect(ledger.commands[2]).to.include({
      state: 'credit_gated',
      blockerCategory: 'explicit_credit_approval',
      priorLiveSuccessDate: '2026-07-19',
    });
    expect(JSON.stringify(ledger)).not.to.match(/target-org|username|orgFingerprint|argv/u);
  });

  it('promotes approved action successes and records current live failures instead of stale credit gates', async () => {
    // @ts-expect-error -- The source-only ledger generator is intentionally plain ESM JavaScript.
    const { buildCompletionLedger } = (await import('../scripts/build-live-completion-ledger.mjs')) as LedgerModule;
    const invocation = (
      command: string,
      exitCode: number
    ): [
      string,
      {
        timestamp: string;
        date: string;
        session: string;
        sequence: number;
        exitCode: number;
        sessionSchemaValid: boolean;
      },
    ] => [
      command,
      {
        timestamp: '2026-07-28T00:00:00.000Z',
        date: '2026-07-28',
        session: 'session-safe',
        sequence: exitCode + 1,
        exitCode,
        sessionSchemaValid: true,
      },
    ];
    const ledger = buildCompletionLedger({
      inventory: [{ id: 'data360 query hybrid' }, { id: 'data360 data-graph refresh' }],
      verification: [
        { command: 'data360 query hybrid', live: '2026-07-28' },
        { command: 'data360 data-graph refresh', live: '2026-07-13' },
      ],
      invocations: new Map([invocation('data360 query hybrid', 0), invocation('data360 data-graph refresh', 1)]),
      errorEvidence: new Map(),
      pendingCommands: ['data360 query hybrid', 'data360 data-graph refresh'],
      generatedAt: '2026-07-28T00:01:00.000Z',
    });

    expect(ledger.summary).to.deep.include({
      invoked: 2,
      liveSuccess: 1,
      liveFailure: 1,
      creditGated: 0,
    });
    expect(ledger.commands[0]).to.include({
      state: 'live_success',
      evidenceDate: '2026-07-28',
      blockerCategory: null,
    });
    expect(ledger.commands[1]).to.include({
      state: 'live_failure',
      evidenceDate: '2026-07-28',
      blockerCategory: 'action_outcome_unknown',
      priorLiveSuccessDate: '2026-07-13',
    });
  });

  it('does not let an older failed trace override newer successful verification', async () => {
    // @ts-expect-error -- The source-only ledger generator is intentionally plain ESM JavaScript.
    const { buildCompletionLedger } = (await import('../scripts/build-live-completion-ledger.mjs')) as LedgerModule;
    const ledger = buildCompletionLedger({
      inventory: [{ id: 'data360 data-graph refresh' }],
      verification: [{ command: 'data360 data-graph refresh', live: '2026-07-29' }],
      invocations: new Map([
        [
          'data360 data-graph refresh',
          {
            timestamp: '2026-07-28T00:00:00.000Z',
            date: '2026-07-28',
            session: 'older-failure',
            sequence: 1,
            exitCode: 69,
            sessionSchemaValid: true,
          },
        ],
      ]),
      errorEvidence: new Map(),
      pendingCommands: ['data360 data-graph refresh'],
      generatedAt: '2026-07-29T01:00:00.000Z',
    });

    expect(ledger.summary).to.deep.include({ liveSuccess: 1, liveFailure: 0 });
    expect(ledger.commands[0]).to.include({
      state: 'live_success',
      evidenceDate: '2026-07-29',
      blockerCategory: null,
    });
  });

  it('excludes leaky sessions while preserving the validation quality of older traces', async () => {
    // @ts-expect-error -- The source-only ledger generator is intentionally plain ESM JavaScript.
    const { loadLatestInvocations } = (await import('../scripts/build-live-completion-ledger.mjs')) as LedgerModule;
    const directory = await mkdtemp(resolve(tmpdir(), 'd360-ledger-sessions-'));
    const writeSession = async (
      name: string,
      schemaValid: boolean,
      leakScanClean: boolean,
      timestamp: string
    ): Promise<void> => {
      const session = resolve(directory, name);
      await mkdir(session);
      await writeFile(
        resolve(session, 'session.json'),
        `${JSON.stringify({
          endedAt: timestamp,
          validation: { schemaValid, leakScanClean },
        })}\n`
      );
      await writeFile(
        resolve(session, 'events.jsonl'),
        [
          {
            type: 'command.exec',
            seq: 1,
            ts: timestamp,
            command: 'data360:doctor',
          },
          {
            type: 'command.result',
            seq: 2,
            seqRef: 1,
            exitCode: 0,
          },
        ]
          .map((entry) => JSON.stringify(entry))
          .join('\n')
      );
    };
    try {
      await writeSession('valid', true, true, '2026-07-26T00:00:00.000Z');
      await writeSession('newer-schema-invalid', false, true, '2026-07-26T00:30:00.000Z');
      await writeSession('newest-leaky', true, false, '2026-07-26T01:00:00.000Z');

      const latest = await loadLatestInvocations(directory);
      expect(latest.get('data360 doctor')).to.include({
        session: 'valid',
        timestamp: '2026-07-26T00:00:00.000Z',
        exitCode: 0,
        sessionSchemaValid: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
