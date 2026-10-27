import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { datasetFromText } from '../src/core/infer.js';
import { runRecipe } from '../src/core/clean.js';
import { stepToPython, stepsToPython, stepsToText } from '../src/core/codegen.js';

const CSV = 'date,city,amount,notes,Jan,Feb\n2024-03-04, NY ,10,ok,1,2\n2024-03-04,ny,,ok,3,4\n2024-03-05,Boston,30,"a, b",5,6\n2024-03-05,Boston,30,"a, b",5,6\n2024-04-01,LA,50,x,7,8\n';
const STEPS = [
  { op: 'removeDuplicates' },
  { op: 'text', column: 'city', transform: 'trim' },
  { op: 'standardize', column: 'city', map: { ny: 'NY' } },
  { op: 'fillMissing', column: 'amount', method: 'median' },
  { op: 'rename', column: 'notes', to: 'comment' },
  { op: 'replace', column: 'city', find: 'LA', replace: 'Los Angeles', match: 'exact' },
  { op: 'dateParts', column: 'date', part: 'month', name: 'month' },
  { op: 'keepRows', filters: [{ column: 'amount', op: '>', value: '5' }] },
  { op: 'unpivot', columns: ['Jan', 'Feb'], nameColumn: 'Month', valueColumn: 'Value' },
];

test('every step has readable pandas code', () => {
  for (const s of STEPS) assert.ok(stepToPython(s).length > 10, s.op);
  assert.match(stepsToText(STEPS, 'sales'), /^Cleaning steps for sales:\n1\. Remove duplicate rows/);
  assert.match(stepToPython({ op: 'formula', name: 'x', formula: 'a * 2' }), /^# New column x = a \* 2/);
});

let pandas = false;
try {
  execFileSync('python3', ['-c', 'import pandas'], { stdio: 'ignore' });
  pandas = true;
} catch {
  /* no pandas on this machine: the run-it-for-real test is skipped */
}

test('the exported script gives the same result as Lumora', { skip: !pandas && 'pandas is not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumora-py-'));
  writeFileSync(join(dir, 'sales.csv'), CSV);
  writeFileSync(join(dir, 'clean.py'), stepsToPython(STEPS, 'sales.csv'));
  execFileSync('python3', ['clean.py'], { cwd: dir, stdio: 'ignore' });
  const py = datasetFromText(readFileSync(join(dir, 'sales clean.csv'), 'utf8'), 'out.csv');
  const ours = runRecipe(datasetFromText(CSV, 'sales.csv'), STEPS);
  assert.deepEqual(py.columns.map((c) => c.name), ours.columns.map((c) => c.name));
  assert.equal(py.rowCount, ours.rowCount);
  for (const name of ['city', 'amount', 'comment', 'month', 'Month', 'Value']) {
    assert.deepEqual(py.columns.find((c) => c.name === name).values, ours.columns.find((c) => c.name === name).values, name);
  }
});
