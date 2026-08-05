import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import { BULK_UPLOAD_CAP_BYTES, splitCsvFiles } from '../src/ingest/csvChunks.js';

const describeLarge = process.env.D360_LARGE_FILE_TEST === '1' ? describe : describe.skip;

describeLarge('ingest generated large-file gate', () => {
  it('splits a generated file above the decimal 150 MB cap without committed artifacts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data360-large-csv-'));
    try {
      const source = join(directory, 'generated.csv');
      const output = createWriteStream(source, { mode: 0o600 });
      output.write('id,value\n');
      const row = `1,${'x'.repeat(999_996)}\n`;
      for (let index = 0; index < 151; index += 1) {
        if (!output.write(row)) await once(output, 'drain');
      }
      output.end();
      await once(output, 'close');
      expect((await stat(source)).size).to.be.greaterThan(BULK_UPLOAD_CAP_BYTES);

      const sizes: number[] = [];
      for await (const chunk of splitCsvFiles([source])) {
        sizes.push(chunk.bytes);
        expect((await stat(chunk.path)).size).to.equal(chunk.bytes);
        expect(chunk.bytes).to.be.lessThan(BULK_UPLOAD_CAP_BYTES);
      }
      expect(sizes).to.have.length(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
