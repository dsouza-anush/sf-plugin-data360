import { isDeepStrictEqual } from 'node:util';

const jsonPathValue = (value, path) => {
  if (path === '$') return value;
  if (!path.startsWith('$.')) return undefined;
  return path
    .slice(2)
    .replaceAll(/\[(\d+)\]/gu, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce((current, part) => (current === undefined || current === null ? undefined : current[part]), value);
};

export const evaluateExpectations = (expected = {}, result) => {
  const checks = [];
  const add = (name, pass, wanted, actual) => checks.push({ name, pass, expected: wanted, actual });
  if (expected.exitCode !== undefined)
    add('exitCode', result.exitCode === expected.exitCode, expected.exitCode, result.exitCode);
  if (expected.exitCodeOneOf)
    add('exitCodeOneOf', expected.exitCodeOneOf.includes(result.exitCode), expected.exitCodeOneOf, result.exitCode);
  for (const value of expected.stdoutIncludes ?? [])
    add(`stdoutIncludes:${value}`, result.stdout.includes(value), value, result.stdout.slice(0, 4096));
  for (const value of expected.stdoutExcludes ?? [])
    add(`stdoutExcludes:${value}`, !result.stdout.includes(value), `not ${value}`, result.stdout.slice(0, 4096));
  for (const value of expected.stderrIncludes ?? [])
    add(`stderrIncludes:${value}`, result.stderr.includes(value), value, result.stderr);
  for (const value of expected.stderrExcludes ?? [])
    add(`stderrExcludes:${value}`, !result.stderr.includes(value), `not ${value}`, result.stderr);
  if (expected.maxDurationMs !== undefined)
    add('maxDurationMs', result.durationMs <= expected.maxDurationMs, expected.maxDurationMs, result.durationMs);
  for (const [path, matcher] of Object.entries(expected.jsonPath ?? {})) {
    const actual = jsonPathValue(result.jsonEnvelope, path);
    if (matcher.exists !== undefined)
      add(`${path}:exists`, (actual !== undefined) === matcher.exists, matcher.exists, actual);
    if (Object.hasOwn(matcher, 'equals'))
      add(`${path}:equals`, isDeepStrictEqual(actual, matcher.equals), matcher.equals, actual);
    if (matcher.matches !== undefined)
      add(`${path}:matches`, new RegExp(matcher.matches, 'u').test(String(actual)), matcher.matches, actual);
  }
  return checks;
};
