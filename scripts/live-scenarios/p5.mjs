import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runFoundationScenario } from './foundation.mjs';

const step = (id, dependsOn = [], details = {}) => ({ id, dependsOn, ...details });
const name = (prefix, suffix, maxLength = 40) => {
  const ending = `_${suffix}`;
  const combined = `${prefix}${ending}`;
  if (combined.length <= maxLength) return combined;
  const entropy = prefix.match(/_[a-f0-9]{6}$/iu)?.[0] ?? '';
  const base = entropy ? prefix.slice(0, -entropy.length) : prefix;
  const available = maxLength - entropy.length - ending.length;
  if (available < 1) throw new Error(`Cannot preserve P5 name entropy within ${maxLength} characters`);
  return `${base.slice(0, available)}${entropy}${ending}`;
};
const p5CreditFamilies = new Map([
  ['data360 query', 'query'],
  ['data360 query vector', 'query'],
  ['data360 query hybrid', 'query'],
  ['data360 identity-resolution run', 'identity-resolution'],
  ['data360 calculated-insight run', 'calculated-insight'],
  ['data360 segment publish', 'segment'],
  ['data360 data-graph refresh', 'data-graph'],
]);

export const parseP5Options = (environment = process.env, options = {}) => {
  if (environment.D360_LIVE_MUTATIONS !== '1') throw new Error('P5 scenario requires D360_LIVE_MUTATIONS=1');
  const billable = !options.cleanupOnly && environment.D360_LIVE_BILLABLE === '1';
  const graphRefreshOnly = !options.cleanupOnly && environment.D360_LIVE_P5_GRAPH_REFRESH_ONLY === '1';
  const segmentOnly = !options.cleanupOnly && environment.D360_LIVE_P5_SEGMENT_ONLY === '1';
  const dataKitOnly = !options.cleanupOnly && environment.D360_LIVE_P5_DATA_KIT_ONLY === '1';
  const identityOnly = !options.cleanupOnly && environment.D360_LIVE_P5_IDENTITY_ONLY === '1';
  if (graphRefreshOnly && !billable) throw new Error('P5 graph-refresh-only scenario requires D360_LIVE_BILLABLE=1');
  if (segmentOnly && !billable) throw new Error('P5 segment-only scenario requires D360_LIVE_BILLABLE=1');
  if (dataKitOnly && environment.D360_LIVE_DATA_KIT_MUTATIONS !== '1')
    throw new Error('P5 data-kit-only scenario requires D360_LIVE_DATA_KIT_MUTATIONS=1');
  if (identityOnly && !billable) throw new Error('P5 identity-only scenario requires D360_LIVE_BILLABLE=1');
  if ([graphRefreshOnly, segmentOnly, dataKitOnly, identityOnly].filter(Boolean).length > 1)
    throw new Error(
      'P5 graph-refresh-only, segment-only, data-kit-only, and identity-only modes are mutually exclusive'
    );
  return options.cleanupOnly
    ? { mutations: true, billable: false, cleanupOnly: true }
    : {
        mutations: true,
        billable,
        ...(environment.D360_LIVE_SHARED_DATA === '1' ? { sharedData: true } : {}),
        ...(environment.D360_LIVE_EXISTING_SEARCH === '1' ? { existingSearch: true } : {}),
        ...(environment.D360_LIVE_PROFILE_LOOKUP === '1' ? { profileLookup: true } : {}),
        ...(environment.D360_LIVE_IDENTITY === '1' ? { identity: true } : {}),
        ...(environment.D360_LIVE_DATA_KIT_MUTATIONS === '1' ? { dataKitMutations: true } : {}),
        ...(environment.D360_LIVE_CONTRACT_PROBES_ONLY === '1' ? { contractProbesOnly: true } : {}),
        ...(graphRefreshOnly ? { graphRefreshOnly: true } : {}),
        ...(segmentOnly ? { segmentOnly: true } : {}),
        ...(dataKitOnly ? { dataKitOnly: true } : {}),
        ...(identityOnly ? { identityOnly: true } : {}),
      };
};

export const p5CreditFamily = (command) => p5CreditFamilies.get(command);

export const validateP5BillablePlan = (plan, familyCaps = {}) => {
  const executableByFamily = new Map();
  for (const current of plan) {
    const derivedFamily = p5CreditFamily(current.command);
    if (derivedFamily) {
      if (current.billable !== true || current.billableFamily !== derivedFamily) {
        throw new Error(`${current.id} must be classified as billable family ${derivedFamily}`);
      }
      if (!current.blocker) {
        const count = (executableByFamily.get(derivedFamily) ?? 0) + 1;
        if (count > (familyCaps[derivedFamily] ?? 1)) {
          throw new Error(`P5 billable cap exceeded for ${derivedFamily}`);
        }
        executableByFamily.set(derivedFamily, count);
      }
    } else if (current.billable || current.billableFamily) {
      throw new Error(`${current.id} declares billing for a non-credit command`);
    }
  }
  return plan;
};

export const isP5CreateCollision = (error) =>
  /(?:\b409\b|already exists|conflict|duplicate|DUPLICATE_VALUE)/iu.test(
    error instanceof Error ? error.message : String(error)
  );

export const isP5RemoteAbsent = (payload) => {
  const body = Array.isArray(payload) ? payload[0] : payload;
  const httpStatus = body?.data?.httpStatus ?? body?.httpStatus;
  const apiCode = body?.data?.apiCode ?? body?.apiCode ?? body?.errorCode;
  const remoteCode = ['NOT_FOUND', 'ITEM_NOT_FOUND'].includes(String(apiCode));
  const typedNotFound = /\bnot found\b|\bdoes not exists?\b/iu.test(String(body?.message ?? body?.error ?? ''));
  return httpStatus === 404 || (remoteCode && httpStatus === undefined) || typedNotFound;
};

const containsExactName = (value, fields, expected) => {
  if (Array.isArray(value)) return value.some((entry) => containsExactName(entry, fields, expected));
  if (!value || typeof value !== 'object') return false;
  if (fields.some((field) => value[field] === expected)) return true;
  return Object.values(value).some((entry) => containsExactName(entry, fields, expected));
};

export const proveP5NameAvailable = (current, listPayload, now = () => new Date()) => {
  if (!current.absenceFrom || !current.creates || !Array.isArray(current.absenceFields)) {
    throw new Error(`${current.id} has no exact pre-create absence contract`);
  }
  if (containsExactName(listPayload, current.absenceFields, current.creates)) {
    throw new Error(`Disposable name already exists and is not scenario-owned: ${current.creates}`);
  }
  return {
    status: 'absent',
    name: current.creates,
    sourceStep: current.absenceFrom,
    provedAt: now().toISOString(),
  };
};

export const p5CleanupKey = (current) => {
  const planned = typeof current.creates === 'string' && current.creates.length > 0 ? current.creates : undefined;
  if (!planned || isP5CreateCollision(current.createFailureReason ?? '')) return undefined;
  const createdItem = current.createEvidence?.payload?.result?.item ?? current.createEvidence?.payload?.result;
  const exactCreatedKey = extractP5Identity(createdItem, current.cleanupEndpointKeyFields ?? []);
  if (exactCreatedKey) return exactCreatedKey;
  return current.cleanupAllowsPlannedName === true &&
    current.ownershipProof?.status === 'absent' &&
    current.ownershipProof?.name === planned
    ? planned
    : undefined;
};

export const verifyP5Cleanup = async ({ current, remove, read, isAbsent }) => {
  const key = p5CleanupKey(current);
  if (!key) {
    const planned = current.ownershipProof?.status === 'absent' ? current.ownershipProof?.name : undefined;
    if (planned && planned === current.creates) {
      try {
        const absence = await read(planned);
        if (isAbsent(absence)) return { exitCode: 0, deletionConfirmed: true };
      } catch {}
    }
    return {
      exitCode: 1,
      deletionConfirmed: false,
      reason: 'No exact scenario-owned create name was proven; cleanup retained rather than guessing',
    };
  }
  let deleteError;
  try {
    await remove(key);
  } catch (error) {
    deleteError = String(error);
  }
  try {
    const absence = await read(key);
    if (isAbsent(absence)) return { exitCode: 0, deletionConfirmed: true };
    return {
      exitCode: 1,
      deletionConfirmed: false,
      reason: `Resource ${key} did not return a verified not-found response${
        deleteError ? ` after delete failed: ${deleteError}` : ''
      }`,
    };
  } catch (error) {
    return {
      exitCode: 1,
      deletionConfirmed: false,
      reason: String(error).includes('Expected command failure')
        ? `Resource ${key} still exists after delete${deleteError ? ` (${deleteError})` : ''}`
        : `${String(error)}${deleteError ? `; delete failed: ${deleteError}` : ''}`,
    };
  }
};

export const createP5Prefix = (date = new Date(), random = Math.random) => {
  const stamp = date
    .toISOString()
    .replaceAll(/[-:TZ.]/gu, '')
    .slice(0, 14);
  const entropy = Math.floor(random() * 0xffffff)
    .toString(16)
    .padStart(6, '0');
  return `lv_p5_${stamp}_${entropy}`;
};

const rulesetId = (prefix) => {
  let hash = 0;
  for (const character of prefix) hash = (hash * 31 + character.codePointAt(0)) % 46_656;
  return `r${hash.toString(36).padStart(3, '0')}`;
};

export const p5Names = (prefix) => {
  return {
    dmo: `${name(prefix, 'model', 34)}__dlm`,
    identity: rulesetId(prefix),
    dataKit: name(prefix, 'kit'),
    dataKitDlo: `${name(prefix, 'kit_source', 34)}__dll`,
    activationTarget: name(prefix, 'activation_target'),
    activation: name(prefix, 'activation'),
    transform: name(prefix, 'transform'),
    calculatedInsight: name(prefix, 'ci__cio'),
    segment: name(prefix, 'seg'),
    searchIndex: name(prefix, 'idx'),
    dataGraph: name(prefix, 'dg'),
  };
};

export const extractP5Identity = (value, fields = ['developerName', 'name', 'id']) => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = extractP5Identity(entry, fields);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  for (const field of fields) {
    if (typeof value[field] === 'string' && value[field]) return value[field];
  }
  for (const entry of Object.values(value)) {
    const found = extractP5Identity(entry, fields);
    if (found) return found;
  }
  return undefined;
};

export const selectReadySearchIndex = (payload) => {
  const result = payload?.result ?? payload;
  const items = Array.isArray(result) ? result : result?.items;
  if (!Array.isArray(items)) return undefined;
  const ready = items.find((item) =>
    ['READY', 'ACTIVE', 'COMPLETED'].includes(item?.runtimeStatus ?? item?.status ?? item?.indexStatus)
  );
  return extractP5Identity(ready, ['developerName', 'name', 'id']);
};

export const selectP5DataKitComponent = (payload, expectedName) => {
  const result = payload?.result ?? payload;
  const items = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : result?.components;
  if (!Array.isArray(items)) return undefined;
  const item = items.find((entry) => {
    const type = entry?.type ?? entry?.componentType;
    const componentName = entry?.info?.name ?? entry?.developerName ?? entry?.name;
    return (
      type === 'DataLakeObject' &&
      typeof componentName === 'string' &&
      componentName.length > 0 &&
      (expectedName === undefined || componentName === expectedName)
    );
  });
  if (!item) return undefined;
  const componentName = item.info?.name ?? item.developerName ?? item.name;
  const label = item.info?.label ?? item.label;
  return {
    type: item.type ?? item.componentType,
    info: {
      name: componentName,
      ...(typeof label === 'string' && label ? { label } : {}),
    },
  };
};

export const p5DataKitComponentDefinitions = (component) => {
  if (component?.type !== 'DataLakeObject' || typeof component?.info?.name !== 'string' || !component.info.name) {
    throw new Error('A selected DataLakeObject component name is required');
  }
  const deploymentComponent = { type: component.type, name: component.info.name };
  return {
    update: { components: [component] },
    deploy: { components: [deploymentComponent] },
    undeploy: { components: [deploymentComponent] },
  };
};

export const buildP5IdentityCloneDefinition = (item, prefix) => {
  if (!item || typeof item !== 'object' || !Array.isArray(item.matchRules) || item.matchRules.length === 0) {
    throw new Error('A live identity ruleset with match rules is required for a disposable clone');
  }
  const names = p5Names(prefix);
  const definition = {
    rulesetId: names.identity,
    label: `${prefix} identity`,
    description: 'Disposable clone of a test-org identity ruleset for CLI verification',
  };
  for (const key of [
    'configurationType',
    'dataSpaceName',
    'doesRunAutomatically',
    'isCaseSensitive',
    'matchRules',
    'reconciliationRules',
    'filters',
    'objectApiName',
    'secondaryDmo',
  ]) {
    if (item[key] !== undefined) definition[key] = structuredClone(item[key]);
  }
  definition.doesRunAutomatically = false;
  return definition;
};

const queryRecords = (payload) => {
  const result = payload?.result ?? payload;
  if (
    Array.isArray(result?.rows) &&
    result.rows.every((row) => row && typeof row === 'object' && !Array.isArray(row))
  ) {
    return result.rows;
  }
  if (Array.isArray(result?.rows) && Array.isArray(result?.columns)) {
    const names = result.columns.map((column) => column?.name).filter((entry) => typeof entry === 'string');
    return result.rows.map((row) =>
      Object.fromEntries(names.map((column, index) => [column, Array.isArray(row) ? row[index] : undefined]))
    );
  }
  return [];
};

export const deriveProfileLookup = (payload, metadata = payload) => {
  const record = queryRecords(payload)[0];
  const entity = extractP5Identity(metadata, [
    'dataModelName',
    'entityName',
    'apiName',
    'name',
    'referenceModelEntityDeveloperName',
  ]);
  const dataSource = extractP5Identity(record, ['ssot__DataSourceId__c', 'DataSourceId__c']);
  const dataSourceObject = extractP5Identity(record, ['ssot__DataSourceObjectId__c', 'DataSourceObjectId__c']);
  const recordId = extractP5Identity(record, ['ssot__Id__c', 'Id__c', 'id']);
  if (!entity || !dataSource || !dataSourceObject || !recordId) return undefined;
  return { entity, dataSource, dataSourceObject, record: recordId };
};

export const matchesP5ExpectedError = (payload, expected) =>
  payload?.code === expected.code &&
  (expected.action === undefined || payload?.actions?.includes(expected.action) === true) &&
  (expected.apiCode === undefined || payload?.data?.apiCode === expected.apiCode);

export const executeP5Bounded = async (
  execute,
  {
    waitMs,
    delayMs = 10_000,
    now = Date.now,
    sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
  }
) => {
  const deadline = now() + waitMs;
  let lastError;
  for (;;) {
    try {
      return await execute(Math.max(1, deadline - now()));
    } catch (error) {
      lastError = error;
      const remaining = deadline - now();
      if (remaining <= 0) throw error;
      await sleep(Math.min(delayMs, remaining));
      if (now() >= deadline) throw lastError;
    }
  }
};

const pendingQueryStatuses = new Set(['queued', 'running', 'submitted', 'inprogress', 'processing']);

export const pendingQueryRequiredBlocker = (payload, operation) => {
  const status = extractP5Identity(payload, ['completionStatus', 'status']);
  if (status && pendingQueryStatuses.has(status.toLowerCase())) return undefined;
  return status
    ? `Query reached terminal or unknown status ${status} at submit; ${operation} was not invoked and is not live-verified`
    : `Query submission did not return a confirmed pending status; ${operation} was not invoked and is not live-verified`;
};

export const queryCacheDependencies = (plan) =>
  Object.fromEntries(
    plan
      .filter(({ id }) => ['query-resume', 'query-results', 'query-cancel'].includes(id))
      .map(({ id, dependsOn }) => [id, dependsOn])
  );

export const buildP5Plan = (prefix, options = {}) => {
  if (!/^[A-Za-z][A-Za-z0-9_]{2,48}$/u.test(prefix)) {
    throw new Error('P5 prefix must be API-safe and 3-49 characters');
  }
  const names = p5Names(prefix);
  const plan = [
    step('disposable-dmo-list', [], { command: 'data360 dmo list' }),
    step('disposable-dmo-create', ['disposable-dmo-list'], {
      command: 'data360 dmo create',
      creates: names.dmo,
      absenceFrom: 'disposable-dmo-list',
      absenceFields: ['developerName', 'name', 'id'],
      definition: 'dmo',
      cleanup: ['data360', 'dmo', 'delete', '--name', names.dmo, '--no-prompt'],
      cleanupKeyFields: ['developerName', 'name', 'id'],
      cleanupEndpoint: '/data-model-objects/{key}',
      cleanupEndpointKeyFields: ['developerName', 'name', 'id'],
      cleanupAllowsPlannedName: true,
    }),
    step('disposable-dmo-get', ['disposable-dmo-create'], {
      command: 'data360 dmo get',
      nameFrom: 'disposable-dmo-create',
    }),
    step('query-one-shot', [], {
      command: 'data360 query',
      billable: true,
      billableFamily: 'query',
      blocker:
        'No scenario-owned synthetic P5 data is provisioned; shared Account records are not queried by this scenario',
    }),
    step('query-async', [], {
      command: 'data360 query',
      billable: true,
      billableFamily: 'query',
      blocker:
        'The single P5 query credit is reserved for the bounded one-shot probe; async/resume requires a separately authorized run',
    }),
    step('query-resume', ['query-async'], {
      command: 'data360 query resume',
      args: ['--use-most-recent'],
      omitTargetOrg: true,
      requiresPendingFrom: 'query-async',
    }),
    step('query-results', ['query-resume'], {
      command: 'data360 query results',
      args: ['--use-most-recent'],
      omitTargetOrg: true,
    }),
    step('query-cancel-submit', [], {
      command: 'data360 query',
      billable: true,
      billableFamily: 'query',
      blocker:
        'No bounded query is guaranteed to remain pending for cancellation; the former unbounded cross-join proof is intentionally removed',
    }),
    step('query-cancel', ['query-cancel-submit'], {
      command: 'data360 query cancel',
      args: ['--use-most-recent'],
      omitTargetOrg: true,
      requiresPendingFrom: 'query-cancel-submit',
    }),
    step('profile-describe', [], { command: 'data360 profile describe', args: ['--name', 'ssot__Account__dlm'] }),
    step('profile-get', ['query-one-shot'], {
      command: 'data360 profile get',
      blocker: 'No scenario-owned synthetic profile record exists; arbitrary Account profile bodies are not read',
    }),
    step('profile-lookup', ['query-one-shot', 'profile-describe'], {
      command: 'data360 profile lookup',
      blocker: 'No scenario-owned synthetic profile path exists; arbitrary universal IDs are not read',
    }),
    step('identity-list', [], { command: 'data360 identity-resolution list' }),
    step('identity-create', ['identity-list'], {
      command: 'data360 identity-resolution create',
      creates: names.identity,
      absenceFrom: 'identity-list',
      absenceFields: ['rulesetId', 'name', 'label', 'id'],
      definition: 'identity',
      cleanup: ['data360', 'identity-resolution', 'delete', '--name', names.identity, '--no-prompt'],
      cleanupKeyFields: ['id', 'rulesetId', 'name'],
      cleanupEndpoint: '/identity-resolutions/{key}',
      cleanupEndpointKeyFields: ['id'],
      cleanupAllowsPlannedName: false,
      blocker:
        'No mapped Contact Point Email, Phone, or Address criterion is verified for a safe disposable identity ruleset',
    }),
    step('identity-get', ['identity-create'], {
      command: 'data360 identity-resolution get',
      nameFrom: 'identity-create',
    }),
    step('identity-update', ['identity-get'], {
      command: 'data360 identity-resolution update',
      nameFrom: 'identity-create',
      definition: 'identityUpdate',
    }),
    step('identity-run', ['identity-update'], {
      command: 'data360 identity-resolution run',
      nameFrom: 'identity-create',
      args: ['--no-prompt'],
      billable: true,
      billableFamily: 'identity-resolution',
    }),
    step('identity-delete', ['identity-update'], {
      command: 'data360 identity-resolution delete',
      nameFrom: 'identity-create',
      args: ['--no-prompt'],
    }),
    step('calculated-insight-list', [], { command: 'data360 calculated-insight list' }),
    step('calculated-insight-create', ['calculated-insight-list', 'disposable-dmo-get'], {
      command: 'data360 calculated-insight create',
      creates: names.calculatedInsight,
      absenceFrom: 'calculated-insight-list',
      absenceFields: ['apiName', 'developerName', 'name', 'id'],
      definition: 'calculatedInsight',
      cleanup: ['data360', 'calculated-insight', 'delete', '--name', names.calculatedInsight, '--no-prompt'],
      cleanupKeyFields: ['apiName', 'developerName', 'name', 'id'],
      cleanupEndpoint: '/calculated-insights/{key}',
      cleanupEndpointKeyFields: ['apiName'],
      cleanupAllowsPlannedName: true,
    }),
    step('calculated-insight-get', ['calculated-insight-create'], {
      command: 'data360 calculated-insight get',
      nameFrom: 'calculated-insight-create',
      boundedWait: true,
      waitMs: 5 * 60_000,
    }),
    step('calculated-insight-update', ['calculated-insight-get'], {
      command: 'data360 calculated-insight update',
      nameFrom: 'calculated-insight-create',
      definition: 'calculatedInsightUpdate',
    }),
    step('calculated-insight-describe', ['calculated-insight-get'], {
      command: 'data360 calculated-insight query',
      nameFrom: 'calculated-insight-create',
      args: ['--describe'],
    }),
    step('calculated-insight-values', ['calculated-insight-get'], {
      command: 'data360 calculated-insight query',
      nameFrom: 'calculated-insight-create',
      args: ['--dimensions', 'record_id__c', '--measures', 'record_count__c'],
    }),
    step('calculated-insight-run', ['calculated-insight-update', 'calculated-insight-describe'], {
      command: 'data360 calculated-insight run',
      nameFrom: 'calculated-insight-create',
      args: ['--no-prompt'],
      billable: true,
      billableFamily: 'calculated-insight',
    }),
    step('segment-list', [], { command: 'data360 segment list' }),
    step('segment-create', ['segment-list', 'disposable-dmo-get'], {
      command: 'data360 segment create',
      creates: names.segment,
      absenceFrom: 'segment-list',
      absenceFields: ['segmentApiName', 'developerName', 'name', 'marketSegmentId', 'id'],
      definition: 'segment',
      cleanup: ['data360', 'segment', 'delete', '--name', names.segment, '--no-prompt'],
      cleanupKeyFields: ['segmentApiName', 'developerName', 'name', 'marketSegmentId', 'id'],
      cleanupEndpoint: '/segments/{key}',
      cleanupEndpointKeyFields: ['segmentApiName', 'apiName'],
      cleanupAllowsPlannedName: true,
    }),
    step('segment-get', ['segment-create'], {
      command: 'data360 segment get',
      nameFrom: 'segment-create',
      waitForSegmentReady: true,
      waitMs: 5 * 60_000,
    }),
    step('segment-update', ['segment-get'], {
      command: 'data360 segment update',
      nameFrom: 'segment-create',
      definition: 'segmentUpdate',
    }),
    step('segment-get-after-update', ['segment-update'], {
      command: 'data360 segment get',
      nameFrom: 'segment-create',
      waitForSegmentReady: true,
      waitMs: 5 * 60_000,
    }),
    step('segment-publish', ['segment-get-after-update'], {
      command: 'data360 segment publish',
      nameFrom: 'segment-create',
      args: ['--wait', '5', '--no-prompt'],
      timeoutMs: 6 * 60_000,
      billable: true,
      billableFamily: 'segment',
    }),
    step('segment-deactivate', ['segment-publish'], {
      command: 'data360 segment deactivate',
      nameFrom: 'segment-create',
      args: ['--no-prompt'],
    }),
    step('activation-list', [], { command: 'data360 activation list' }),
    step('activation-platforms', [], { command: 'data360 activation platforms' }),
    step('activation-target-list', [], { command: 'data360 activation-target list' }),
    step('activation-target-create', ['activation-target-list'], {
      command: 'data360 activation-target create',
      blocker: 'No disposable activation target can be created without real external credentials',
    }),
    step('activation-create', ['activation-list', 'activation-target-create'], {
      command: 'data360 activation create',
      blocker: 'No disposable activation target exists; existing targets must not be mutated',
    }),
    step('activation-update', ['activation-create'], {
      command: 'data360 activation update',
      blocker: 'No disposable activation exists',
    }),
    step('activation-delete', ['activation-create'], {
      command: 'data360 activation delete',
      blocker: 'No disposable activation exists',
    }),
    step('search-index-list', [], { command: 'data360 search-index list' }),
    step('search-index-create', ['search-index-list', 'disposable-dmo-get'], {
      command: 'data360 search-index create',
      creates: names.searchIndex,
      absenceFrom: 'search-index-list',
      absenceFields: ['developerName', 'name', 'id'],
      definition: 'searchIndex',
      cleanup: ['data360', 'search-index', 'delete', '--name', names.searchIndex, '--no-prompt'],
      cleanupKeyFields: ['developerName', 'name', 'id'],
      cleanupEndpoint: '/search-index/{key}',
      cleanupEndpointKeyFields: ['id'],
      cleanupAllowsPlannedName: false,
    }),
    step('search-index-get', ['search-index-create'], {
      command: 'data360 search-index get',
      nameFrom: 'search-index-create',
    }),
    step('search-index-update', ['search-index-get'], {
      command: 'data360 search-index update',
      nameFrom: 'search-index-create',
      definition: 'searchIndexUpdate',
    }),
    step('search-index-describe', ['search-index-get'], {
      command: 'data360 search-index describe',
      nameFrom: 'search-index-get',
    }),
    step('query-vector', ['search-index-describe'], {
      command: 'data360 query vector',
      indexFrom: 'search-index-create',
      args: ['--text', 'account', '--top-k', '1'],
      billable: true,
      billableFamily: 'query',
      blocker: 'The P5 query-family credit cap is already allocated to the bounded one-shot query',
    }),
    step('query-hybrid', ['search-index-describe'], {
      command: 'data360 query hybrid',
      indexFrom: 'search-index-create',
      args: ['--text', 'account', '--top-k', '1'],
      billable: true,
      billableFamily: 'query',
      blocker: 'The P5 query-family credit cap is already allocated to the bounded one-shot query',
    }),
    step('data-graph-list', [], { command: 'data360 data-graph list' }),
    step('data-graph-create', ['data-graph-list', 'disposable-dmo-get'], {
      command: 'data360 data-graph create',
      creates: names.dataGraph,
      absenceFrom: 'data-graph-list',
      absenceFields: ['dataGraphName', 'developerName', 'name', 'id'],
      definition: 'dataGraph',
      cleanup: ['data360', 'data-graph', 'delete', '--name', names.dataGraph, '--no-prompt'],
      cleanupKeyFields: ['dataGraphName', 'developerName', 'name', 'id'],
      cleanupEndpoint: '/data-graphs/{key}',
      cleanupEndpointKeyFields: ['dataGraphName', 'name'],
      cleanupAllowsPlannedName: true,
    }),
    step('data-graph-get', ['data-graph-create'], {
      command: 'data360 data-graph get',
      nameFrom: 'data-graph-create',
      boundedWait: true,
      waitMs: 5 * 60_000,
    }),
    step('data-graph-query', ['data-graph-get', 'query-one-shot'], {
      command: 'data360 data-graph query',
      blocker: 'No scenario-owned synthetic graph record exists; arbitrary Account graph bodies are not read',
    }),
    step('data-graph-refresh', ['data-graph-get'], {
      command: 'data360 data-graph refresh',
      nameFrom: 'data-graph-create',
      billable: true,
      billableFamily: 'data-graph',
      timeoutMs: 6 * 60_000,
    }),
    ...(options.includeDataKit
      ? [
          step('data-kit-dlo-list', [], { command: 'data360 dlo list' }),
          step('data-kit-dlo-create', ['data-kit-dlo-list'], {
            command: 'data360 dlo create',
            creates: names.dataKitDlo,
            absenceFrom: 'data-kit-dlo-list',
            absenceFields: ['developerName', 'name', 'id'],
            definition: 'dataKitDlo',
            cleanup: ['data360', 'dlo', 'delete', '--name', names.dataKitDlo, '--no-prompt'],
            cleanupKeyFields: ['developerName', 'name', 'id'],
            cleanupEndpoint: '/data-lake-objects/{key}',
            cleanupEndpointKeyFields: ['id'],
            cleanupAllowsPlannedName: true,
          }),
          step('data-kit-list', [], { command: 'data360 data-kit list', timeoutMs: 180_000 }),
          step('data-kit-absence', [], {
            command: 'data360 api request',
            args: [`/datakit/${encodeURIComponent(names.dataKit)}/manifest`, '--method', 'GET'],
            expectedFailure: true,
          }),
          step('data-kit-create', ['data-kit-absence', 'data-kit-dlo-create'], {
            command: 'data360 data-kit create',
            creates: names.dataKit,
            absenceNotFoundFrom: 'data-kit-absence',
            definition: 'dataKitCreate',
            cleanup: ['data360', 'data-kit', 'delete', '--name', names.dataKit, '--no-prompt'],
            cleanupKeyFields: ['devName', 'dataKitDevName', 'developerName', 'name', 'id'],
            cleanupEndpoint: '/data-kits/{key}',
            cleanupEndpointKeyFields: ['devName', 'dataKitDevName', 'developerName', 'name'],
            cleanupAllowsPlannedName: true,
          }),
          step('data-kit-available-owned', ['data-kit-create'], {
            command: 'data360 data-kit available',
            dataKitFrom: 'data-kit-create',
            args: ['--component-type', 'DataLakeObject', '--limit', '200'],
            expectedComponent: names.dataKitDlo,
            waitForDataKitComponent: true,
            waitMs: 5 * 60_000,
            timeoutMs: 180_000,
          }),
          step('data-kit-update', ['data-kit-available-owned'], {
            command: 'data360 data-kit update',
            nameFrom: 'data-kit-create',
            definition: 'dataKitUpdate',
            args: ['--no-prompt'],
          }),
          step('data-kit-manifest-owned', ['data-kit-update'], {
            command: 'data360 data-kit manifest',
            nameFrom: 'data-kit-create',
          }),
          step('data-kit-component-dependencies', ['data-kit-update'], {
            command: 'data360 data-kit component dependencies',
            nameFrom: 'data-kit-create',
            componentFrom: 'data-kit-available-owned',
            includeComponentType: true,
          }),
          step('data-kit-deploy', ['data-kit-update'], {
            command: 'data360 data-kit deploy',
            nameFrom: 'data-kit-create',
            definition: 'dataKitDeploy',
          }),
          step('data-kit-component-status', ['data-kit-deploy'], {
            command: 'data360 data-kit component status',
            nameFrom: 'data-kit-create',
            componentFrom: 'data-kit-available-owned',
            waitForDataKitActive: true,
            waitMs: 10 * 60_000,
          }),
          step('data-kit-undeploy', ['data-kit-update'], {
            command: 'data360 data-kit undeploy',
            nameFrom: 'data-kit-create',
            definition: 'dataKitUndeploy',
            args: ['--no-prompt'],
            expectedFailure: true,
            allowSuccess: true,
          }),
          step('data-kit-delete', ['data-kit-undeploy'], {
            command: 'data360 data-kit delete',
            nameFrom: 'data-kit-create',
            args: ['--no-prompt'],
          }),
        ]
      : []),
    step('metadata-list', [], { command: 'data360 metadata list' }),
    step('metadata-get-account', ['metadata-list'], {
      command: 'data360 metadata get',
      args: ['--name', 'ssot__Account__dlm'],
    }),
    step('metadata-search', [], {
      command: 'data360 metadata search',
      blocker: 'Metadata search is specified but is not shipped in the current 135-command snapshot',
    }),
  ];
  if (options.allowSharedData) {
    const byId = new Map(plan.map((current) => [current.id, current]));
    const query = byId.get('query-one-shot');
    delete query.blocker;
    query.query = 'SELECT "ssot__Id__c" FROM "ssot__Account__dlm" LIMIT 1';

    const profileGet = byId.get('profile-get');
    delete profileGet.blocker;
    profileGet.name = 'ssot__Account__dlm';
    profileGet.recordFrom = 'query-one-shot';

    const profileLookup = byId.get('profile-lookup');
    delete profileLookup.blocker;
    profileLookup.profileLookupFrom = 'query-one-shot';
    profileLookup.blockerUnlessProfilePath = true;

    for (const id of ['calculated-insight-create', 'segment-create', 'search-index-create', 'data-graph-create']) {
      delete byId.get(id).blocker;
    }
    const graphQuery = byId.get('data-graph-query');
    delete graphQuery.blocker;
    graphQuery.nameFrom = 'data-graph-create';
    graphQuery.recordFrom = 'query-one-shot';
  }
  if (options.useProfileLookup) {
    const byId = new Map(plan.map((current) => [current.id, current]));
    const query = byId.get('query-one-shot');
    delete query.blocker;
    query.query =
      'SELECT "ssot__Id__c", "ssot__DataSourceId__c", "ssot__DataSourceObjectId__c" FROM "ssot__Account__dlm" LIMIT 1';
    const profileGet = byId.get('profile-get');
    delete profileGet.blocker;
    profileGet.name = 'ssot__Account__dlm';
    profileGet.recordFrom = 'query-one-shot';
    const profileLookup = byId.get('profile-lookup');
    delete profileLookup.blocker;
    profileLookup.profileLookupFrom = 'query-one-shot';
    profileLookup.blockerUnlessProfilePath = true;
  }
  if (options.allowIdentity) {
    const identityCreate = plan.find(({ id }) => id === 'identity-create');
    delete identityCreate.blocker;
  }
  if (options.useExistingSearch) {
    const byId = new Map(plan.map((current) => [current.id, current]));
    byId.get('search-index-create').blocker =
      'Existing-search verification mode uses a READY demo index and does not create another index';
    Object.assign(byId.get('search-index-describe'), {
      dependsOn: ['search-index-list'],
      nameFrom: 'search-index-list',
    });
    for (const id of ['query-vector', 'query-hybrid']) {
      const current = byId.get(id);
      current.dependsOn = ['search-index-list'];
      current.indexFrom = 'search-index-list';
      delete current.blocker;
    }
  }
  const selectedIds = options.graphRefreshOnly
    ? [
        'disposable-dmo-list',
        'disposable-dmo-create',
        'disposable-dmo-get',
        'data-graph-list',
        'data-graph-create',
        'data-graph-get',
        'data-graph-refresh',
      ]
    : options.segmentOnly
      ? [
          'disposable-dmo-list',
          'disposable-dmo-create',
          'disposable-dmo-get',
          'segment-list',
          'segment-create',
          'segment-get',
          'segment-update',
          'segment-get-after-update',
          'segment-publish',
          'segment-deactivate',
        ]
      : options.dataKitOnly
        ? [
            'data-kit-dlo-list',
            'data-kit-dlo-create',
            'data-kit-list',
            'data-kit-absence',
            'data-kit-create',
            'data-kit-available-owned',
            'data-kit-update',
            'data-kit-manifest-owned',
            'data-kit-component-dependencies',
            'data-kit-deploy',
            'data-kit-component-status',
            'data-kit-undeploy',
            'data-kit-delete',
          ]
        : options.identityOnly
          ? ['identity-list', 'identity-create', 'identity-get', 'identity-update', 'identity-run', 'identity-delete']
          : null;
  const selectedPlan = selectedIds ? plan.filter(({ id }) => selectedIds.includes(id)) : plan;
  if (options.allowBillable === false) {
    for (const current of selectedPlan) {
      if (p5CreditFamily(current.command) && !current.blocker) {
        current.blocker =
          'Billable execution is disabled; obtain separate Data 360 credit approval and set D360_LIVE_BILLABLE=1';
      }
    }
  }
  return validateP5BillablePlan(selectedPlan, options.useExistingSearch ? { query: 2 } : {});
};

export const buildP5ContractProbePlan = (prefix) => {
  if (!/^[A-Za-z][A-Za-z0-9_]{2,48}$/u.test(prefix)) {
    throw new Error('P5 prefix must be API-safe and 3-49 characters');
  }
  const names = p5Names(prefix);
  return [
    step('probe-activation-target-create', [], {
      command: 'data360 activation-target create',
      definition: 'invalidProbe',
      expectedFailure: true,
    }),
    step('probe-activation-target-update', [], {
      command: 'data360 activation-target update',
      name: names.activationTarget,
      definition: 'activationTargetUpdate',
      expectedFailure: true,
    }),
    step('probe-activation-create', [], {
      command: 'data360 activation create',
      definition: 'invalidProbe',
      expectedFailure: true,
    }),
    step('probe-activation-results', [], {
      command: 'data360 activation results',
      name: names.activation,
      expectedFailure: true,
    }),
    step('probe-activation-update', [], {
      command: 'data360 activation update',
      name: names.activation,
      definition: 'activationUpdate',
      expectedFailure: true,
    }),
    step('probe-activation-delete', [], {
      command: 'data360 activation delete',
      name: names.activation,
      args: ['--no-prompt'],
      expectedFailure: true,
    }),
    step('probe-data-graph-query', [], {
      command: 'data360 data-graph query',
      name: names.dataGraph,
      args: ['--id', `${prefix}_no_record`],
      expectedFailure: true,
    }),
    step('probe-data-graph-delete', [], {
      command: 'data360 data-graph delete',
      name: names.dataGraph,
      args: ['--no-prompt'],
      expectedFailure: true,
    }),
    step('probe-calculated-insight-update', [], {
      command: 'data360 calculated-insight update',
      name: names.calculatedInsight,
      definition: 'calculatedInsightUpdate',
      expectedFailure: true,
    }),
    step('probe-segment-update', [], {
      command: 'data360 segment update',
      name: names.segment,
      definition: 'segmentUpdate',
      expectedFailure: true,
    }),
    step('probe-search-index-delete', [], {
      command: 'data360 search-index delete',
      name: names.searchIndex,
      args: ['--no-prompt'],
      expectedFailure: true,
    }),
    step('probe-data-space-member-set', [], {
      command: 'data360 data-space member set',
      name: name(prefix, 'space'),
      definition: 'dataSpaceMembers',
      expectedFailure: true,
    }),
    step('probe-query-resume', [], {
      command: 'data360 query resume',
      args: ['--query-id', `${prefix}_query`],
      expectedFailure: true,
    }),
    step('probe-query-results', [], {
      command: 'data360 query results',
      args: ['--query-id', `${prefix}_query`, '--row-limit', '1'],
      expectedFailure: true,
    }),
    step('probe-query-cancel', [], {
      command: 'data360 query cancel',
      args: ['--query-id', `${prefix}_query`],
      expectedFailure: true,
      allowSuccess: true,
    }),
    step('probe-token-display', [], {
      command: 'data360 token display',
      expectedFailure: true,
      allowSuccess: true,
      recordFixture: false,
    }),
    step('probe-identity-update', [], {
      command: 'data360 identity-resolution update',
      name: names.identity,
      definition: 'identityUpdate',
      expectedFailure: true,
    }),
    step('probe-transform-create', [], {
      command: 'data360 transform create',
      definition: 'invalidProbe',
      expectedFailure: true,
    }),
    step('probe-transform-update', [], {
      command: 'data360 transform update',
      name: names.transform,
      definition: 'transformUpdate',
      expectedFailure: true,
    }),
    step('probe-transform-get', [], {
      command: 'data360 transform get',
      name: names.transform,
      expectedFailure: true,
    }),
    step('probe-transform-validate', [], {
      command: 'data360 transform validate',
      name: names.transform,
      expectedFailure: true,
    }),
    step('probe-transform-report', [], {
      command: 'data360 transform report',
      name: names.transform,
      args: ['--history'],
      expectedFailure: true,
    }),
    step('probe-transform-retry', [], {
      command: 'data360 transform retry',
      name: names.transform,
      expectedFailure: true,
    }),
    step('probe-transform-cancel', [], {
      command: 'data360 transform cancel',
      name: names.transform,
      args: ['--no-prompt'],
      expectedFailure: true,
    }),
    step('probe-transform-schedule-set', [], {
      command: 'data360 transform schedule set',
      name: names.transform,
      args: ['--interval', 'DAILY'],
      expectedFailure: true,
    }),
    step('probe-transform-schedule-display', [], {
      command: 'data360 transform schedule display',
      name: names.transform,
      expectedFailure: true,
    }),
    step('probe-transform-delete', [], {
      command: 'data360 transform delete',
      name: names.transform,
      args: ['--no-prompt'],
      expectedFailure: true,
    }),
  ];
};

export const writeP5Definitions = async (directory, prefix) => {
  const names = p5Names(prefix);
  const sourceDmo = names.dmo;
  const definitions = {
    dmo: {
      name: sourceDmo.replace(/__dlm$/u, ''),
      label: `${prefix} model`,
      description: 'Disposable empty P5 live verification model',
      dataSpaceName: 'default',
      category: 'PROFILE',
      fields: [
        {
          name: 'record_id__c',
          label: 'Record ID',
          dataType: 'Text',
          isPrimaryKey: true,
          isDynamicLookup: false,
        },
        {
          name: 'display_name__c',
          label: 'Display Name',
          dataType: 'Text',
          isPrimaryKey: false,
          isDynamicLookup: false,
        },
      ],
    },
    identity: {
      label: `${prefix} identity`,
      description: 'Disposable P5 identity verification ruleset',
      configurationType: 'individual',
      rulesetId: names.identity,
      doesRunAutomatically: false,
      matchRules: [
        {
          label: 'Exact name and birth date',
          criteria: [
            {
              entityName: 'ssot__Individual__dlm',
              fieldName: 'ssot__FirstName__c',
              matchMethodType: 'exact',
              caseSensitiveMatch: false,
              shouldMatchOnBlank: false,
            },
            {
              entityName: 'ssot__Individual__dlm',
              fieldName: 'ssot__LastName__c',
              matchMethodType: 'exact',
              caseSensitiveMatch: false,
              shouldMatchOnBlank: false,
            },
            {
              entityName: 'ssot__Individual__dlm',
              fieldName: 'ssot__BirthDate__c',
              matchMethodType: 'exact',
              caseSensitiveMatch: false,
              shouldMatchOnBlank: false,
            },
          ],
        },
      ],
      reconciliationRules: [
        {
          entityName: 'ssot__Individual__dlm',
          ruleType: 'lastupdated',
          shouldIgnoreEmptyValue: true,
          sources: [],
          fields: [],
        },
      ],
    },
    identityUpdate: { label: `${prefix} identity updated`, description: 'Disposable P5 identity verification update' },
    calculatedInsight: {
      apiName: names.calculatedInsight,
      displayName: `${prefix.slice(0, 26)} Count`,
      definitionType: 'CALCULATED_METRIC',
      dataSpaceName: 'default',
      description: 'Disposable P5 account count',
      expression: `SELECT COUNT(${sourceDmo}.record_id__c) AS record_count__c, ${sourceDmo}.record_id__c AS record_id__c FROM ${sourceDmo} GROUP BY ${sourceDmo}.record_id__c`,
      publishScheduleInterval: 'NotScheduled',
    },
    calculatedInsightUpdate: {
      displayName: `${prefix.slice(0, 18)} Count Updated`,
      description: 'Disposable P5 account count update',
    },
    segment: {
      displayName: `${prefix} segment`,
      developerName: names.segment,
      description: 'Disposable P5 Account segment',
      segmentType: 'Dbt',
      includeDbt: {
        models: {
          models: [
            {
              name: 'Account',
              sql: `SELECT ${sourceDmo}.record_id__c FROM ${sourceDmo} WHERE ${sourceDmo}.record_id__c IS NOT NULL`,
            },
          ],
        },
      },
    },
    segmentUpdate: {
      displayName: `${prefix} segment updated`,
      developerName: names.segment,
      description: 'Disposable P5 Account segment update',
      segmentType: 'Dbt',
      includeDbt: {
        models: {
          models: [
            {
              name: 'Account',
              sql: `SELECT ${sourceDmo}.record_id__c FROM ${sourceDmo} WHERE ${sourceDmo}.record_id__c IS NOT NULL`,
            },
          ],
        },
      },
    },
    searchIndex: {
      label: `${prefix.slice(0, 26)} Index`,
      developerName: names.searchIndex,
      sourceDmoDeveloperName: sourceDmo,
      chunkDmoName: `${names.searchIndex} chunk`,
      chunkDmoDeveloperName: `${names.searchIndex}_chunk`,
      vectorDmoName: `${names.searchIndex} index`,
      vectorDmoDeveloperName: `${names.searchIndex}_index`,
      vectorEmbedding: { vectorEmbeddingRelatedFields: [] },
      chunkingConfiguration: {
        fieldLevelConfigurations: [
          {
            sourceDmoDeveloperName: sourceDmo,
            sourceDmoFieldDeveloperName: 'display_name__c',
            decorators: [],
            config: {
              id: 'passage_extraction',
              userValues: [
                { id: 'strip_html', value: 'true' },
                { id: 'max_tokens', value: '128' },
              ],
            },
          },
        ],
      },
      vectorEmbeddingConfiguration: {
        embeddingModel: {
          id: 'e5_large_v2',
          userValues: [],
        },
        index: {
          id: 'HNSW',
          userValues: [],
        },
        similarityMetric: 'COSINE',
      },
      searchType: 'VECTOR',
      rankingConfigurations: [],
    },
    searchIndexUpdate: { label: `${prefix.slice(0, 18)} Index Updated` },
    dataGraph: {
      dataspaceName: 'default',
      description: 'Disposable P5 Account graph',
      label: `${prefix.slice(0, 26)} Graph`,
      name: names.dataGraph,
      primaryObjectName: sourceDmo,
      type: 'NONE',
      sourceObject: {
        name: sourceDmo,
        type: 'custom',
        recencyCriteria: [],
        path: [],
        jsonPath: '$',
        fields: [
          {
            isKeyColumn: true,
            sourceFieldName: 'record_id__c',
            dataType: 'TEXT',
            isProjected: true,
            keyQualifierName: '',
            usageTag: 'NONE',
          },
          {
            isKeyColumn: false,
            sourceFieldName: 'display_name__c',
            dataType: 'TEXT',
            isProjected: true,
            keyQualifierName: '',
            usageTag: 'NONE',
          },
        ],
        relatedObjects: [],
      },
    },
    dataKitCreate: {
      dataKitDevName: names.dataKit,
      label: `${prefix.slice(0, 32)} Kit`,
      dataKitType: 'None',
      components: [],
    },
    dataKitDlo: {
      name: names.dataKitDlo.replace(/__dll$/u, ''),
      label: `${prefix.slice(0, 28)} Kit Source`,
      category: 'Profile',
      dataLakeFieldInputRepresentations: [
        { name: 'record_id', label: 'Record ID', dataType: 'Text', isPrimaryKey: true },
        { name: 'display_name', label: 'Display Name', dataType: 'Text', isPrimaryKey: false },
      ],
    },
    dataKitUpdate: { components: [] },
    dataKitDeploy: { components: [] },
    dataKitUndeploy: { components: [] },
    invalidProbe: [],
    activationTargetUpdate: { maxFileSize: 1 },
    activationUpdate: { displayName: `${prefix.slice(0, 28)} Activation` },
    transformUpdate: { label: `${prefix.slice(0, 30)} Transform` },
    dataSpaceMembers: {
      members: [{ memberName: `${prefix}_member`, filter: { field: 'Id', operator: 'EQUALS', value: prefix } }],
    },
  };
  definitions.searchIndexUpdate = {
    ...definitions.searchIndex,
    label: `${prefix.slice(0, 18)} Index Updated`,
  };
  await mkdir(directory, { recursive: true });
  const files = {};
  for (const [key, definition] of Object.entries(definitions)) {
    const path = resolve(directory, `${key}.json`);
    await writeFile(path, `${JSON.stringify(definition, undefined, 2)}\n`, { mode: 0o600 });
    files[key] = path;
  }
  return files;
};

export const argsForP5Step = (current, files, dynamic = {}) => {
  const args = current.command.split(' ');
  const resolvedName = current.nameFrom ? dynamic.resourceKeys?.[current.nameFrom] : current.name;
  if (resolvedName) args.push('--name', resolvedName);
  if (current.dataKitFrom) {
    const dataKit = dynamic.resourceKeys?.[current.dataKitFrom];
    if (!dataKit) throw new Error(`No Data Kit key recorded by ${current.dataKitFrom}`);
    args.push('--data-kit', dataKit);
  }
  if (current.componentFrom) {
    const component = dynamic.dataKitComponents?.[current.componentFrom];
    if (!component?.info?.name) throw new Error(`No Data Kit component recorded by ${current.componentFrom}`);
    args.push('--component', component.info.name);
    if (current.includeComponentType) args.push('--component-type', component.type);
  }
  if (current.definition) args.push('--file', files[current.definition]);
  if (current.query) args.push('--query', current.query);
  if (current.recordFrom) {
    const record = dynamic.recordIds?.[current.recordFrom];
    if (!record) throw new Error(`No record ID recorded by ${current.recordFrom}`);
    args.push('--id', record);
  }
  if (current.profileLookupFrom) {
    const lookup = dynamic.profileLookups?.[current.profileLookupFrom];
    if (!lookup)
      throw new Error(`All four live profile lookup path IDs were not available from ${current.profileLookupFrom}`);
    args.push(
      '--entity',
      lookup.entity,
      '--data-source',
      lookup.dataSource,
      '--data-source-object',
      lookup.dataSourceObject,
      '--record',
      lookup.record
    );
  }
  if (current.indexFrom) {
    const index = dynamic.resourceKeys?.[current.indexFrom];
    if (!index) throw new Error(`No search index key recorded by ${current.indexFrom}`);
    args.push('--index', index);
  }
  args.push(...(current.args ?? []));
  if (
    [
      'data360 data-graph refresh',
      'data360 data-space member set',
      'data360 query',
      'data360 query cancel',
      'data360 query hybrid',
      'data360 query vector',
      'data360 transform retry',
      'data360 transform schedule set',
    ].includes(current.command) &&
    !args.includes('--no-prompt')
  )
    args.push('--no-prompt');
  return args;
};

export const runP5Scenario = async (options) => runFoundationScenario(options);
