import { runFoundationScenario } from './foundation.mjs';

const recordedFixtures = new Map([
  ['data360 docai describe', 'live/docai-describe.json'],
  ['data360 retriever list', 'live/retriever-list.json'],
  ['data360 retriever get', 'live/retriever-get.json'],
  ['data360 retriever configuration list', 'live/retriever-configuration-list.json'],
  ['data360 docai config list', 'live/docai-config-list.json'],
  ['data360 semantic model list', 'live/semantic-model-list.json'],
  ['data360 data-action list', 'live/data-action-list.json'],
  ['data360 data-action-target list', 'live/data-action-target-list.json'],
]);

const step = (id, command, operation, details = {}) => ({
  id,
  dependsOn: [],
  command,
  operation,
  contract: recordedFixtures.has(command) ? 'recorded' : 'documented',
  ...(recordedFixtures.has(command) ? { fixture: recordedFixtures.get(command) } : {}),
  timeoutMs: 30_000,
  ...details,
});

export const parseP6Options = () => ({ mutations: false, billable: false, readOnly: true });

export const createP6Prefix = (date = new Date(), random = Math.random) => {
  const stamp = date
    .toISOString()
    .replaceAll(/[-:TZ.]/gu, '')
    .slice(0, 14);
  const entropy = Math.floor(random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `lv_p6_${stamp}_${entropy}`;
};

export const runP6BoundedProbe = async (execute, { timeoutMs, signal } = {}) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error('P6 probe timeout must be between 1 and 30000 ms');
  }
  if (signal?.aborted) {
    return { status: 'aborted', reason: String(signal.reason ?? 'caller aborted') };
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  let timeout;
  try {
    const outcome = await Promise.race([
      Promise.resolve()
        .then(() => execute(controller.signal))
        .then((value) => ({ status: 'completed', value })),
      new Promise((resolve) => {
        timeout = setTimeout(() => {
          controller.abort(new Error(`P6 probe exceeded ${timeoutMs} ms`));
          resolve({ status: 'timed-out', reason: `P6 probe exceeded ${timeoutMs} ms` });
        }, timeoutMs);
      }),
      ...(signal
        ? [
            new Promise((resolve) => {
              signal.addEventListener(
                'abort',
                () => resolve({ status: 'aborted', reason: String(signal.reason ?? 'caller aborted') }),
                { once: true }
              );
            }),
          ]
        : []),
    ]);
    return outcome;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
};

const resultItems = (payload) => {
  const result = payload?.result ?? payload;
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return undefined;
  for (const key of ['items', 'configurations', 'retrievers', 'models', 'dataActions', 'dataActionTargets']) {
    if (Array.isArray(result[key])) return result[key];
  }
  return undefined;
};

const evidencePayload = (evidence, id) => evidence[id]?.payload ?? evidence[id];

const firstIdentity = (payload, fields) => {
  const items = resultItems(payload) ?? [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    for (const field of fields) {
      if (typeof item[field] === 'string' && item[field]) return item[field];
    }
  }
  return undefined;
};

const preferredDataKitIdentity = (payload) => {
  const items = resultItems(payload) ?? [];
  const preferred = items.find((item) => item?.dataKitType === 'SANDBOX') ?? items[0];
  if (!preferred || typeof preferred !== 'object') return undefined;
  for (const field of ['devName', 'dataKitDevName', 'developerName', 'name', 'id']) {
    if (typeof preferred[field] === 'string' && preferred[field]) return preferred[field];
  }
  return undefined;
};

const localDataKitIdentity = (payload) => {
  const items = resultItems(payload) ?? [];
  const local = items.find((item) => item?.dataKitType === 'SANDBOX' || item?.dataKitSource !== 'EXTERNAL');
  if (!local || typeof local !== 'object') return undefined;
  for (const field of ['devName', 'dataKitDevName', 'developerName', 'name', 'id']) {
    if (typeof local[field] === 'string' && local[field]) return local[field];
  }
  return undefined;
};

const dependencyComponentTypes = ['DataTransform', 'DataStreamBundle', 'SemanticModel', 'DataLakeObject'];

const preferredDeployedDataKitComponent = (payload) => {
  const items = resultItems(payload) ?? [];
  for (const componentType of dependencyComponentTypes) {
    for (const item of items) {
      if (!item || typeof item !== 'object' || !Array.isArray(item.components)) continue;
      const component = item.components.find(
        (candidate) =>
          candidate?.componentType === componentType &&
          typeof candidate.developerName === 'string' &&
          candidate.developerName
      );
      if (!component) continue;
      const dataKit = ['devName', 'dataKitDevName', 'developerName', 'name', 'id']
        .map((field) => item[field])
        .find((value) => typeof value === 'string' && value);
      if (typeof dataKit === 'string') {
        return { dataKit, component: { name: component.developerName, type: component.componentType } };
      }
    }
  }
  return undefined;
};

export const p6DependencyBlocker = (current, evidence) => {
  for (const dependency of current.dependsOn ?? []) {
    const dependencyEvidence = evidence[dependency];
    if (dependencyEvidence?.classification?.status && dependencyEvidence.classification.status !== 'verified') {
      return `${dependency} did not produce verified evidence; ${current.operation} was not invoked`;
    }
    const items = resultItems(evidencePayload(evidence, dependency));
    if (Array.isArray(items) && items.length === 0) {
      return `${dependency} returned an empty list; ${current.operation} payload shape remains unverified`;
    }
  }
  if (current.id === 'data-kit-manifest' && !localDataKitIdentity(evidencePayload(evidence, 'data-kit-list'))) {
    return 'data-kit-list returned no local or sandbox kit; manifest was not invoked against an external package';
  }
  return undefined;
};

export const argsForP6Step = (current, evidence = {}) => {
  if (current.path) return ['data360', 'api', 'request', current.path];
  const args = [...current.command.split(' '), ...(current.args ?? [])];
  const retriever = firstIdentity(evidencePayload(evidence, 'retriever-list'), [
    'name',
    'retrieverName',
    'developerName',
    'id',
  ]);
  if (['retriever-get', 'retriever-config-list'].includes(current.id) && retriever) {
    args.push('--name', retriever);
  }
  const dataKit = preferredDataKitIdentity(evidencePayload(evidence, 'data-kit-list'));
  if (current.id === 'data-kit-available' && dataKit) args.push('--data-kit', dataKit);
  const localDataKit = localDataKitIdentity(evidencePayload(evidence, 'data-kit-list'));
  if (current.id === 'data-kit-manifest' && localDataKit) args.push('--name', localDataKit);
  if (['data-kit-component-dependencies', 'data-kit-component-status'].includes(current.id)) {
    const deployed = preferredDeployedDataKitComponent(evidencePayload(evidence, 'data-kit-list'));
    if (deployed) {
      args.push('--name', deployed.dataKit, '--component', deployed.component.name);
      if (current.id === 'data-kit-component-dependencies') {
        args.push('--component-type', deployed.component.type);
      }
    }
  }
  return args;
};

export const classifyP6Evidence = ({ operation, payload, fixture, error, timedOut = false, expectedError = false }) => {
  if (timedOut) {
    return {
      status: 'timed-out',
      commandEligible: false,
      reason:
        error instanceof Error
          ? error.message
          : typeof error === 'object'
            ? JSON.stringify(error)
            : String(error ?? 'probe timed out'),
    };
  }
  if (error) {
    const serialized = JSON.stringify(error);
    const errorRecord = error && typeof error === 'object' ? error : {};
    const compactReason = `Command failed${
      Number.isInteger(errorRecord.exitCode) ? ` with exit ${errorRecord.exitCode}` : ''
    }${typeof errorRecord.code === 'string' ? ` (${errorRecord.code})` : ''}.`;
    if (error.exitCode === 2 || /Missing required (?:flag|argument)/iu.test(serialized)) {
      return { status: 'failed', commandEligible: false, reason: compactReason };
    }
    const expected =
      expectedError &&
      /\b(?:400|401|403|404|405|409|422|500|501|503)\b|NOT_FOUND|NOT_PROVISIONED|FEATURE/iu.test(serialized);
    return {
      status: expected ? 'expected-error' : 'failed',
      commandEligible: false,
      reason: compactReason,
    };
  }
  if (!fixture?.startsWith('live/')) {
    return {
      status: 'blocked',
      commandEligible: false,
      reason: 'A scrubbed recorded live fixture is required before command generation',
    };
  }
  const items = resultItems(payload);
  if (operation !== 'list' && Array.isArray(items) && items.length === 0) {
    return {
      status: 'blocked',
      commandEligible: false,
      reason: 'An empty list verifies only the collection response, not detail or mutation payloads',
    };
  }
  return { status: 'verified', commandEligible: true };
};

export const p6LedgerStatus = (runStatus, classificationStatus) => {
  if (runStatus !== 'passed') return runStatus;
  if (classificationStatus === 'verified') return 'passed';
  if (classificationStatus === 'expected-error') return 'expectedError';
  if (classificationStatus === 'timed-out') return 'timedOut';
  if (classificationStatus === 'blocked') return 'blocked';
  return 'failed';
};

export const p6CleanupKey = (current) => {
  if (
    typeof current.creates !== 'string' ||
    !current.creates ||
    current.ownershipProof?.status !== 'absent' ||
    current.ownershipProof?.name !== current.creates ||
    !current.createEvidence
  ) {
    return undefined;
  }
  return current.creates;
};

export const p6TtyChecklist = () =>
  ['\\q', '\\dt', '\\d', '\\x', '\\f', '\\o', '\\dataspace', '\\timing', '\\i', '\\last', 'history', 'ctrl-c'].map(
    (id) => ({
      id,
      evidence: 'manual-tty',
      queryDataAllowed: false,
      requiresQuerySubmission: id === '\\i',
      creditApprovalRequired: id === '\\i',
    })
  );

export const buildP6Plan = (prefix) =>
  [
    step('data-kit-list', 'data360 data-kit list', 'list', { timeoutMs: 120_000 }),
    step('data-kit-available', 'data360 data-kit available', 'list', {
      dependsOn: ['data-kit-list'],
      args: ['--component-type', 'DataLakeObject'],
    }),
    step('data-kit-manifest', 'data360 data-kit manifest', 'get', { dependsOn: ['data-kit-list'] }),
    step('data-kit-component-dependencies', 'data360 data-kit component dependencies', 'list', {
      dependsOn: ['data-kit-list'],
    }),
    step('data-kit-component-status', 'data360 data-kit component status', 'get', {
      dependsOn: ['data-kit-list'],
    }),
    step('docai-describe', 'data360 docai describe', 'get'),
    step('docai-config-list', 'data360 docai config list', 'list'),
    step('retriever-list', 'data360 retriever list', 'list'),
    step('retriever-get', 'data360 retriever get', 'get', { dependsOn: ['retriever-list'] }),
    step('retriever-config-list', 'data360 retriever configuration list', 'list', {
      dependsOn: ['retriever-list'],
    }),
    step('semantic-model-list', 'data360 semantic model list', 'list'),
    step('data-action-list', 'data360 data-action list', 'list'),
    step('data-action-target-list', 'data360 data-action-target list', 'list'),
    step('consent-read', 'data360 api request', 'get', {
      probeCommand: 'data360 consent get',
      root: 'core',
      blocker: 'Exact safe consent GET path and required subject semantics are not recorded',
    }),
    ...p6TtyChecklist().map(({ id }, index) =>
      step(`repl-${index}`, 'data360 query repl', 'manual', {
        metaCommand: id,
        contract: 'unknown',
        blocker: 'Manual pseudo-TTY evidence required',
      })
    ),
  ].map((current) => ({ ...current, prefix }));

export const runP6Scenario = async (options) => runFoundationScenario(options);
