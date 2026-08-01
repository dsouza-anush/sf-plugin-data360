import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import { loadQuerySqlOptions, QUERY_PARAMETER_TYPES } from '../src/query/options.js';
import { assertRejects } from './helpers/async.js';

describe('Query SQL request options', () => {
  it('loads the current v67 parameter and settings wire shape', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'query-options-'));
    const path = join(directory, 'options.json');
    await writeFile(
      path,
      JSON.stringify({
        sqlParameters: [
          { name: 'status', type: 'Varchar', value: 'Boarded' },
          { name: 'minimum', type: 'Integer', value: '2' },
        ],
        querySettings: { date_style: 'MDY', lc_time: 'en_US', query_timeout: '1800000ms' },
      })
    );
    expect(await loadQuerySqlOptions(path)).to.deep.equal({
      sqlParameters: [
        { name: 'status', type: 'Varchar', value: 'Boarded' },
        { name: 'minimum', type: 'Integer', value: '2' },
      ],
      querySettings: { date_style: 'MDY', lc_time: 'en_US', query_timeout: '1800000ms' },
    });
    expect(QUERY_PARAMETER_TYPES).to.include.members(['ArrayOfX', 'TimestampTZ', 'Varchar']);
  });

  it('rejects unknown fields, malformed parameters, unsupported types, and non-string settings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'query-options-invalid-'));
    const cases: Array<[unknown, string]> = [
      [{ extra: true }, 'unsupported top-level fields'],
      [{ sqlParameters: {} }, 'must be an array'],
      [{ sqlParameters: [{ name: '', type: 'Varchar', value: 'x' }] }, 'must be an array'],
      [{ sqlParameters: [{ name: 'x', type: 'String', value: 'x' }] }, 'must be an array'],
      [{ querySettings: { query_timeout: 10_000 } }, 'must be an object'],
    ];
    for (const [index, [value, message]] of cases.entries()) {
      const path = join(directory, `${index}.json`);
      await writeFile(path, JSON.stringify(value));
      const error = await assertRejects(loadQuerySqlOptions(path), message);
      expect(error.name).to.equal('D360_INVALID_DEFINITION');
      expect((error as { actions?: string[] }).actions).to.have.length.greaterThan(0);
    }
  });
});
