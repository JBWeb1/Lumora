import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { convertValues, datasetFromText, detectDayFirst, inferType, parseDate, parseNumber } from '../src/core/infer.js';
import { decodeText, isLumoraFile } from '../src/core/encoding.js';
import { datasetToCSV, sortIndices, toCSV } from '../src/core/transform.js';
import { buildChartData } from '../src/core/chartspec.js';
import { joinKey } from '../src/core/combine.js';
import { groupBy } from '../src/core/transform.js';
import { evaluateFormula } from '../src/core/formula.js';

const iso = (t) => new Date(t).toISOString().slice(0, 10);

test('each date column is read day-first or month-first as a whole', () => {
  assert.deepEqual(convertValues(['31.12.2023', '15.01.2024', '01.02.2024'], 'date').map(iso), ['2023-12-31', '2024-01-15', '2024-02-01']);
  assert.deepEqual(convertValues(['12/31/2023', '01/02/2024'], 'date').map(iso), ['2023-12-31', '2024-01-02']);
  assert.deepEqual(convertValues(['01.02.2024', '03.04.2024'], 'date').map(iso), ['2024-02-01', '2024-04-03'], 'dots mean day-first');
  assert.equal(detectDayFirst(['01/02/2024', '03/04/2024']), null, 'ambiguous slashes keep the US default');
  assert.equal(detectDayFirst(['13/02/2024', '02/13/2024']), null, 'contradictory → per value');
});

test('dates never depend on the computer time zone', () => {
  assert.equal(iso(parseDate('Jan 1, 2023')), '2023-01-01');
  assert.equal(iso(parseDate('5 Jan 2023')), '2023-01-05');
  assert.equal(iso(parseDate('September 30 2024')), '2024-09-30');
  assert.equal(parseDate('2023-01-01 00:30'), Date.UTC(2023, 0, 1, 0, 30));
  assert.equal(parseDate('2023-01-01T00:30+02:00'), Date.UTC(2022, 11, 31, 22, 30));
  assert.equal(parseDate('Janxyz 5, 2023'), null);
  assert.equal(inferType(['5 Jan 2023', '6 Feb 2023', '7 Mar 2023']), 'date');
  // Run the same check in two far-apart time zones.
  const script = "import('./src/core/infer.js').then(({parseDate}) => console.log(new Date(parseDate('Jan 1, 2023')).toISOString(), new Date(parseDate('2023-01-01 00:30')).toISOString()))";
  const outs = ['Asia/Tokyo', 'America/Los_Angeles'].map((TZ) => execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ } }).toString().trim());
  assert.equal(outs[0], outs[1]);
  assert.equal(outs[0], '2023-01-01T00:00:00.000Z 2023-01-01T00:30:00.000Z');
});

test('codes with leading zeros and long IDs stay as labels; accounting negatives are numbers', () => {
  assert.notEqual(inferType(['01234', '02134', '10001', '90210']), 'number');
  assert.notEqual(inferType(['12345678901234567890', '12345678901234567891']), 'number');
  assert.equal(inferType(['0', '0.5', '12', '-3']), 'number');
  assert.equal(parseNumber('(1,234.50)'), -1234.5);
  assert.equal(parseNumber('($20)'), -20);
  assert.equal(parseNumber('(-5)'), null);
  assert.notEqual(joinKey('12345678901234567890'), joinKey('12345678901234567891'));
  assert.equal(joinKey('007'), joinKey('7'));
});

test('files in other encodings are decoded', () => {
  const latin = new Uint8Array([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x43, 0x61, 0x66, 0xe9, 0x0a, 0xa3, 0x35]); // "name\nCafé\n£5" in Windows-1252
  assert.equal(decodeText(latin), 'name\nCafé\n£5');
  const utf16 = new Uint8Array([0xff, 0xfe, ...[...'a\tb'].flatMap((c) => [c.charCodeAt(0), 0])]);
  assert.equal(decodeText(utf16), 'a\tb');
  assert.equal(decodeText(new TextEncoder().encode('﻿naïve')), 'naïve');
  assert.equal(decodeText(new TextEncoder().encode('日本')), '日本');
  assert.ok(isLumoraFile('{\n  "kind": "lumora-recipe", "steps": []}'));
  assert.ok(isLumoraFile('{"format":"lumora-project"}'));
  assert.ok(!isLumoraFile('[{"kind":"lumora-recipe"}]'));
});

test('CSV exports never run as spreadsheet formulas', () => {
  const csv = toCSV(['a', 'b'], [['=HYPERLINK("http://x")', '-5'], ['+1+2', '@SUM(A1)'], ['-', 'ok']]);
  assert.equal(csv, `a,b\n"'=HYPERLINK(""http://x"")",-5\n'+1+2,'@SUM(A1)\n'-,ok\n`);
  const d = datasetFromText('n\n-3.5\n', 't.csv');
  assert.equal(datasetToCSV(d, [0]), 'n\n-3.5\n');
});

test('bar charts on number columns are in numeric order; bucket() ranges in order', () => {
  const d = datasetFromText('x\n-10\n-5\n0\n1.25\n1.5\n3\n', 't.csv');
  assert.deepEqual(buildChartData(d, [0, 1, 2, 3, 4, 5], { type: 'bar', x: 0 }).bars.map((b) => b.label), ['-10', '-5', '0', '1.25', '1.5', '3']);
  const q = datasetFromText('q,n\n25,1\n5,2\n15,3\n', 't.csv');
  const ranges = evaluateFormula('bucket(q, 10)', q);
  const withRange = { ...q, columns: [...q.columns, { name: 'r', type: 'category', inferredType: 'category', raw: ranges, values: ranges }] };
  assert.deepEqual(groupBy(withRange, [0, 1, 2], { by: 2, aggs: [{ fn: 'count' }] }).rows.map((r) => r[0]), ['0–10', '10–20', '20–30']);
});

test('sorting a big text column is fast', () => {
  const n = 200_000;
  const raw = Array.from({ length: n }, (_, i) => `Item ${(i * 7919) % n}`);
  const ds = { name: 't', rowCount: n, columns: [{ name: 'x', type: 'text', inferredType: 'text', raw, values: raw }] };
  const t0 = performance.now();
  const sorted = sortIndices(ds, [...Array(n).keys()], 0);
  const ms = performance.now() - t0;
  assert.equal(raw[sorted[0]], 'Item 0');
  assert.equal(raw[sorted[2]], 'Item 2', 'numeric-aware: Item 2 before Item 10');
  assert.ok(ms < 5000, `took ${Math.round(ms)} ms`);
});
