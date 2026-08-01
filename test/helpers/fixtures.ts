import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type FixtureMetadata = {
  __fixture?: unknown;
  synthetic?: boolean;
};

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export const fixturePayload = <T>(fixture: T & FixtureMetadata): T => {
  if (Array.isArray(fixture)) return fixture.map((entry) => fixturePayload(entry)) as T;
  const payload = { ...fixture };
  delete payload.__fixture;
  delete payload.synthetic;
  return payload as T;
};

export const loadFixture = <T>(path: string): T =>
  fixturePayload(JSON.parse(readFileSync(resolve(fixtureRoot, path), 'utf8')) as T & FixtureMetadata);
