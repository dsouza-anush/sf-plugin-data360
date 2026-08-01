#!/usr/bin/env node

import { rm } from 'node:fs/promises';
import { endSession, startSession } from '../testbed/lib/session.mjs';
import { runSuite } from '../testbed/lib/runner.mjs';
import { validateSessionDirectory } from '../testbed/lib/schemas.mjs';

const { sessionDirectory } = await startSession({
  agent: 'scripted-ci',
  model: 'deterministic-smoke',
  mode: 'mock',
  label: 'T2 framework acceptance',
});

let failure;
try {
  const result = await runSuite(sessionDirectory, 'smoke');
  if (result.failed > 0 || result.blocked > 0) throw new Error(`Smoke result: ${JSON.stringify(result)}`);
  await endSession(sessionDirectory);
  const validation = await validateSessionDirectory(sessionDirectory);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  process.stdout.write(
    `PASS Agent Testbed smoke (${validation.session.totals.passed}/${validation.session.totals.steps} scenarios, ${validation.session.totals.httpEvents} HTTP trace events).\n`
  );
} catch (error) {
  failure = error;
} finally {
  await rm(sessionDirectory, { recursive: true, force: true });
}

if (failure) throw failure;
