type HttpMapping = Record<401 | 403 | 404 | 429 | 500, string>;
const ansiPattern = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, 'u');

const requireEvidence = (condition: unknown, criterion: string): void => {
  if (!condition) throw new Error(`${criterion} evidence is incomplete.`);
};

export const assertU1 = (evidence: {
  summary: string;
  exampleCount: number;
  explainedExampleCount: number;
  flagsDocumented: boolean;
}): void => {
  requireEvidence(/^[A-Z].*\.$/u.test(evidence.summary), 'U1 summary');
  requireEvidence(evidence.exampleCount >= 2 && evidence.explainedExampleCount >= 2, 'U1 examples');
  requireEvidence(evidence.flagsDocumented, 'U1 flags');
};

export const assertU2 = (
  evidence:
    | { kind: 'unknown-flag'; exit: number }
    | { kind: 'missing-required'; exit: number; flag: string; message: string; prompted: boolean }
): void => {
  if (evidence.kind === 'unknown-flag') {
    requireEvidence(evidence.exit === 2, 'U2 unknown flag');
    return;
  }

  requireEvidence(
    evidence.exit === 2 && !evidence.prompted && evidence.message.includes(evidence.flag),
    'U2 required flag'
  );
};

export const assertU3 = (matrixAsserted: boolean): void => requireEvidence(matrixAsserted, 'U3 flag matrix');

export const assertU4 = (flags: string[], shortCharsComply: boolean): void => {
  requireEvidence(
    flags.every((flag) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(flag)) && shortCharsComply,
    'U4 flag names'
  );
};

export const assertU5 = (evidence: { envelopeKeys: string[]; schemaValid: boolean }): void => {
  requireEvidence(
    ['result', 'status', 'warnings'].every((key) => evidence.envelopeKeys.includes(key)),
    'U5 JSON envelope'
  );
  requireEvidence(evidence.schemaValid, 'U5 schema');
};

export const assertU6 = (dataOnStdout: boolean, diagnosticsOnStderr: boolean): void => {
  requireEvidence(dataOnStdout && diagnosticsOnStderr, 'U6 stream separation');
};

export const assertU7 = (streams: string | string[]): void =>
  requireEvidence(
    (Array.isArray(streams) ? streams : [streams]).every((stream) => !ansiPattern.test(stream)),
    'U7 ANSI'
  );

export const assertU8 = (evidence: { spinnerCalls: number; promptCalls: number; noticeCalls: number }): void => {
  requireEvidence(
    evidence.spinnerCalls === 0 && evidence.promptCalls === 0 && evidence.noticeCalls === 0,
    'U8 JSON quiet mode'
  );
};

export const assertU9 = (evidence: {
  isSfError: boolean;
  code: string;
  actions: string[];
  rawBodyReachable: boolean;
}): void => {
  requireEvidence(evidence.isSfError && /^D360_[A-Z_]+$/u.test(evidence.code), 'U9 SfError');
  requireEvidence(evidence.actions.length > 0 && evidence.rawBodyReachable, 'U9 recovery details');
};

export const assertU10 = (mapping: HttpMapping & { direct403?: string }): void => {
  requireEvidence(mapping[401] === 'D360_AUTH_EXPIRED', 'U10 401');
  requireEvidence(mapping[403] === 'D360_NOT_PROVISIONED', 'U10 403');
  if (mapping.direct403) requireEvidence(mapping.direct403 === 'D360_SCOPE_MISSING', 'U10 Direct 403');
  requireEvidence(mapping[404] === 'D360_NOT_FOUND', 'U10 404');
  requireEvidence(mapping[429] === 'D360_RATE_LIMITED', 'U10 429');
  requireEvidence(mapping[500] === 'D360_API_ERROR', 'U10 5xx');
};

export const assertU11 = (codes: {
  success: number;
  failure: number;
  parse: number;
  assignedSpecialCodesOnly: boolean;
}): void => {
  requireEvidence(
    codes.success === 0 && codes.failure === 1 && codes.parse === 2 && codes.assignedSpecialCodesOnly,
    'U11 exits'
  );
};

export const assertU12 = (
  evidence:
    | { kind: 'default-org'; resolved: boolean }
    | { kind: 'missing-default'; error?: { message?: string; name?: string } }
): void => {
  if (evidence.kind === 'default-org') {
    requireEvidence(evidence.resolved, 'U12 default org resolution');
    return;
  }

  requireEvidence(Boolean(evidence.error?.name) && Boolean(evidence.error?.message), 'U12 missing default org');
};

export const assertU13 = (apiVersionHonored: boolean, hardcodedVersionFound: boolean): void => {
  requireEvidence(apiVersionHonored && !hardcodedVersionFound, 'U13 API version');
};

export const assertU14 = (observedOrder: string[]): void => {
  requireEvidence(observedOrder.join('>') === 'flag>env>local>global>default', 'U14 data-space precedence');
};

export const assertU15 = (evidence: { stderr: string; stdout: string }): void => {
  requireEvidence(
    ['parse', 'conn', 'req', 'total'].every((phase) => evidence.stderr.includes(phase)) &&
      !/(?:parse|conn|req|total)=/u.test(evidence.stdout),
    'U15 timing'
  );
};
