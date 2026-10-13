import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDataset, datasetFromText } from '../src/core/infer.js';
import { sampleCSV } from '../src/core/samples.js';
import { forecastSeries, regularize } from '../src/core/forecast.js';
import { buildChartData } from '../src/core/chartspec.js';
import { pivotTable, pivotToTable } from '../src/core/transform.js';
import { appendRows, joinColumns, joinKey, matchColumns, previewJoin, rawTable, suggestJoinKeys } from '../src/core/combine.js';
import { applyStep, describeStep, runRecipe } from '../src/core/clean.js';
import { packDataset, unpackDataset } from '../src/core/pack.js';

const DAY = 86400000;
const coffee = datasetFromText(sampleCSV('coffee'), 'Coffee shop sales.csv');
const col = (ds, n) => ds.columns.findIndex((c) => c.name === n);
const all = (ds) => [...Array(ds.rowCount).keys()];

// ---------- forecasting ----------

function rng(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
}

test('forecast follows trend and weekly pattern, and the likely range covers reality', () => {
  const rand = rng(5);
  const truth = (t) => 200 + 1.5 * t + [0, -20, -25, -15, 5, 40, 60][t % 7];
  const start = Date.UTC(2024, 0, 1);
  const points = Array.from({ length: 140 }, (_, t) => ({ x: start + t * DAY, y: truth(t) + rand() * 20 }));
  const f = forecastSeries(points, { unit: 'day', horizon: 14 });
  assert.equal(f.period, 7);
  assert.equal(f.points.length, 14);
  assert.equal(f.points[0].x, start + 140 * DAY);
  let covered = 0;
  f.points.forEach((p, h) => {
    const actual = truth(140 + h);
    assert.ok(Math.abs(p.y - actual) / actual < 0.08, `day ${h}: forecast ${p.y.toFixed(1)} vs ${actual}`);
    assert.ok(p.lo < p.y && p.y < p.hi);
    if (actual >= p.lo && actual <= p.hi) covered++;
  });
  assert.ok(covered >= 11, `80% range should cover most days, covered ${covered}/14`);
  assert.ok(f.points[13].hi - f.points[13].lo > f.points[0].hi - f.points[0].lo, 'range widens further ahead');
  assert.ok(f.accuracy.pctError < 0.1, `back-test error ${f.accuracy.pctError}`);
  assert.ok(Math.abs(f.total.y - f.points.reduce((s, p) => s + p.y, 0)) < 1e-6);
});

test('forecast: monthly data, short series, gaps and non-negative values', () => {
  const months = Array.from({ length: 36 }, (_, i) => ({ x: Date.UTC(2021, i, 1), y: 1000 + 20 * i + 300 * Math.sin((2 * Math.PI * i) / 12) }));
  const f = forecastSeries(months, { unit: 'month', horizon: 6 });
  assert.equal(f.period, 12);
  assert.deepEqual(f.points.map((p) => new Date(p.x).toISOString().slice(0, 7)), ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06']);
  assert.match(forecastSeries(months.slice(0, 5), { unit: 'month', horizon: 3 }).error, /at least 8/);

  const withGap = [0, 1, 2, 4, 5, 6, 7, 8, 9].map((t) => ({ x: Date.UTC(2024, 0, 1) + t * DAY, y: t * 10 }));
  const { series, missing } = regularize(withGap, 'day');
  assert.equal(missing, 1);
  assert.equal(series[3].y, 30);

  const falling = Array.from({ length: 20 }, (_, t) => ({ x: Date.UTC(2024, 0, 1) + t * DAY, y: Math.max(0, 100 - 6 * t) }));
  assert.ok(forecastSeries(falling, { unit: 'day', horizon: 10 }).points.every((p) => p.lo >= 0 && p.y >= 0), 'sales-like data never goes negative');
});

test('line chart data includes the forecast for date axes only', () => {
  const data = buildChartData(coffee, all(coffee), { type: 'line', x: col(coffee, 'date'), y: col(coffee, 'revenue'), forecast: 30 });
  assert.equal(data.forecast.points.length, 30);
  assert.equal(data.forecast.period, 7);
  const noForecast = buildChartData(coffee, all(coffee), { type: 'line', x: col(coffee, 'date'), y: col(coffee, 'revenue') });
  assert.equal(noForecast.forecast, null);
});

// ---------- pivot ----------

test('two-way pivot: counts, averages and correct totals', () => {
  const ds = datasetFromText('day,shift,sales\nMon,am,10\nMon,pm,20\nTue,am,30\nMon,am,40\nTue,pm,\n', 'p.csv');
  const p = pivotTable(ds, all(ds), { rows: 0, columns: 1, fn: 'mean', column: 2 });
  assert.deepEqual(p.rowKeys, ['Mon', 'Tue']);
  assert.deepEqual(p.colKeys, ['am', 'pm']);
  assert.deepEqual(p.cells, [[25, 20], [30, null]]);
  assert.deepEqual(p.rowTotals, [70 / 3, 30], 'row total is the mean of all Mon rows, not the mean of the cells');
  assert.deepEqual(p.colTotals, [80 / 3, 20]);
  assert.equal(p.grandTotal, 25);
  const counts = pivotTable(ds, all(ds), { rows: 0, columns: 1, fn: 'count' });
  assert.deepEqual(counts.cells, [[2, 1], [1, 1]]);
  assert.equal(counts.grandTotal, 5);
  const t = pivotToTable(counts);
  assert.deepEqual(t.headers, ['day \\ shift', 'am', 'pm', 'Total']);
  assert.deepEqual(t.rows.at(-1), ['Total', 3, 2, 5]);
});

test('pivot on the coffee data: weekday rows × month columns, weekday order kept', () => {
  const p = pivotTable(coffee, all(coffee), { rows: col(coffee, 'date'), rowUnit: 'weekday', columns: col(coffee, 'date'), colUnit: 'month', fn: 'mean', column: col(coffee, 'customers') });
  assert.deepEqual(p.rowKeys, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.equal(p.colKeys.length, 12);
  assert.equal(p.colKeys[0], '2024-01');
  const many = pivotTable(coffee, all(coffee), { rows: col(coffee, 'weekday'), columns: col(coffee, 'date'), colUnit: 'day', fn: 'count', maxColumns: 10 });
  assert.equal(many.colKeys.length, 10);
  assert.equal(many.hiddenColumns, 356);
});

// ---------- combining ----------

const jan = datasetFromText('date,product,amount\n2024-01-03,Tea,4.5\n2024-01-09,Cake,6\n', 'January.csv');
const feb = rawTable(datasetFromText('Product , Date,amount,store\nPie,2024-02-01,5,North\n', 'February.csv'));

test('append matches columns by name (ignoring case/spaces) and records the source', () => {
  assert.deepEqual(matchColumns(['date', 'product', 'amount'], feb.headers), { matched: ['date', 'product', 'amount'], onlyBase: [], onlyOther: ['store'] });
  const out = appendRows(jan, feb, { sourceColumn: 'source' });
  assert.equal(out.rowCount, 3);
  assert.deepEqual(out.columns.map((c) => c.name), ['date', 'product', 'amount', 'store', 'source']);
  assert.deepEqual(out.columns[1].values, ['Tea', 'Cake', 'Pie']);
  assert.deepEqual(out.columns[2].values, [4.5, 6, 5]);
  assert.equal(out.columns[0].type, 'date');
  assert.deepEqual(out.columns[3].values, [null, null, 'North']);
  assert.deepEqual(out.columns[4].values, ['January', 'January', 'February']);
  // A third file reuses the existing source column.
  const mar = rawTable(datasetFromText('date,product,amount\n2024-03-02,Tea,4\n', 'March.csv'));
  const three = appendRows(out, mar, { sourceColumn: 'source' });
  assert.deepEqual(three.columns.at(-1).values, ['January', 'January', 'February', 'March']);
});

const orders = datasetFromText('order,customer_id,total\n1,C1,10\n2,C2,20\n3,C9,5\n4,c1,7\n', 'orders.csv');
const customers = rawTable(datasetFromText('id,name,city\nC1,Ann,Oslo\nC2,Bo,Rome\nC3,Cy,Lima\n', 'customers.csv'));

test('join: left, inner and full, keys ignore case, stats preview matches result', () => {
  assert.equal(joinKey(' C1 '), joinKey('c1'));
  assert.equal(joinKey('007'), joinKey('7'));
  const left = joinColumns(orders, customers, { leftKey: 'customer_id', rightKey: 'id', how: 'left' });
  assert.deepEqual(left.columns.map((c) => c.name), ['order', 'customer_id', 'total', 'name', 'city']);
  assert.deepEqual(left.columns[3].values, ['Ann', 'Bo', null, 'Ann']);
  const inner = joinColumns(orders, customers, { leftKey: 'customer_id', rightKey: 'id', how: 'inner' });
  assert.equal(inner.rowCount, 3);
  const full = joinColumns(orders, customers, { leftKey: 'customer_id', rightKey: 'id', how: 'full' });
  assert.equal(full.rowCount, 5);
  assert.deepEqual(full.columns[1].raw.at(-1), 'C3', 'unmatched right rows keep their key');
  for (const how of ['left', 'inner', 'full']) {
    const p = previewJoin(orders, customers, { leftKey: 'customer_id', rightKey: 'id', how });
    assert.equal(p.resultRows, joinColumns(orders, customers, { leftKey: 'customer_id', rightKey: 'id', how }).rowCount, how);
  }
  assert.deepEqual(previewJoin(orders, customers, { leftKey: 'customer_id', rightKey: 'id' }), { leftRows: 4, rightRows: 3, matchedLeft: 3, unmatchedLeft: 1, unmatchedRight: 1, duplicateKeys: 0, resultRows: 4 });
  assert.deepEqual(suggestJoinKeys(orders, customers), { leftKey: 'customer_id', rightKey: 'id', score: suggestJoinKeys(orders, customers).score });
});

test('join renames clashing columns and duplicate keys multiply rows', () => {
  const a = datasetFromText('id,name\n1,x\n2,y\n', 'a.csv');
  const b = rawTable(datasetFromText('id,name\n1,p\n1,q\n', 'b.csv'));
  const out = joinColumns(a, b, { leftKey: 'id', rightKey: 'id' });
  assert.deepEqual(out.columns.map((c) => c.name), ['id', 'name', 'name (b)']);
  assert.equal(out.rowCount, 3);
  assert.equal(previewJoin(a, b, { leftKey: 'id', rightKey: 'id' }).duplicateKeys, 1);
});

test('combine steps replay (undo works) and keep a user-chosen type', () => {
  let ds = applyStep(orders, { op: 'setType', column: 'order', type: 'category' });
  const steps = [{ op: 'setType', column: 'order', type: 'category' }, { op: 'join', data: customers, leftKey: 'customer_id', rightKey: 'id', how: 'left' }];
  ds = runRecipe(orders, steps);
  assert.equal(ds.columns[0].type, 'category', 'type override survives the join');
  assert.equal(ds.columns.length, 5);
  assert.match(describeStep(steps[1]), /Add columns from customers matched on customer_id = id \(keep all rows\)/);
  assert.match(describeStep({ op: 'append', data: feb }), /Add 1 rows from February/);
  assert.equal(runRecipe(orders, steps.slice(0, 1)).columns.length, 3);
});

// ---------- worker hand-off ----------

test('pack/unpack round-trips every column type exactly', () => {
  const ds = buildDataset('t', ['n', 'd', 'b', 'c', 't'], [['1.5', '2024-01-01', 'yes', 'a', 'x\u0000y'], ['', '', '', '', ''], ['-3', '2024-02-29', 'no', 'b', 'z']]);
  const { packed, transfer } = packDataset(ds);
  assert.equal(transfer.length, 3);
  const back = unpackDataset(structuredClone(packed, { transfer }));
  assert.deepEqual(back, ds);
});

test('large file: 300k rows load in reasonable time', () => {
  const lines = ['id,date,store,amount,paid'];
  for (let i = 0; i < 300000; i++) lines.push(`${i},2024-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')},S${i % 40},${(i % 997) / 10},${i % 3 ? 'yes' : 'no'}`);
  const t0 = performance.now();
  const ds = datasetFromText(lines.join('\n'), 'big.csv');
  const ms = performance.now() - t0;
  assert.equal(ds.rowCount, 300000);
  assert.deepEqual(ds.columns.map((c) => c.type), ['number', 'date', 'category', 'number', 'boolean']);
  assert.ok(ms < 8000, `took ${Math.round(ms)} ms`);
});

// ---------- Excel export ----------

import { columnLetter, crc32, datasetSheet, sheetName, writeXlsx } from '../src/core/xlsxwrite.js';
import { readXlsx, unzip } from '../src/core/xlsx.js';

test('xlsx writer helpers', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(columnLetter), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  const used = new Set();
  assert.equal(sheetName('Sales: Q1/Q2 [final]', used), 'Sales  Q1 Q2  final');
  assert.equal(sheetName('sales  q1 q2  final', used), 'sales  q1 q2  final 2');
  assert.equal(sheetName('x'.repeat(40), used).length, 31);
});

test('exported workbook reads back with the same values, types and a native chart', async () => {
  const sheet = datasetSheet(coffee, all(coffee), 'Coffee & <data>');
  const bytes = await writeXlsx({ sheets: [{ ...sheet, chart: { type: 'line', title: 'Revenue', categoryColumn: 0, valueColumns: [col(coffee, 'revenue')] } }] });
  const [back] = await readXlsx(bytes);
  assert.equal(back.name, 'Coffee & <data>');
  assert.deepEqual(back.headers, coffee.columns.map((c) => c.name));
  const ds = buildDataset('back', back.headers, back.rows);
  assert.deepEqual(ds.columns.map((c) => c.type), coffee.columns.map((c) => c.type), 'types survive the round trip');
  for (const name of ['date', 'customers', 'revenue', 'rainy', 'weekday']) {
    assert.deepEqual(ds.columns[col(ds, name)].values, coffee.columns[col(coffee, name)].values, name);
  }
  const zip = unzip(bytes);
  const chart = await zip.text('xl/charts/chart1.xml');
  assert.match(chart, /<c:lineChart>/);
  assert.match(chart, /'Coffee &amp; &lt;data&gt;'!\$J\$2:\$J\$367/);
  assert.match(await zip.text('[Content_Types].xml'), /drawingml\.chart\+xml/);
});

test('min/max work on very large columns (no call-stack overflow)', async () => {
  const { aggregate } = await import('../src/core/transform.js');
  const big = Array.from({ length: 500000 }, (_, i) => (i * 7919) % 100003);
  assert.equal(aggregate(big, 'min'), 0);
  assert.equal(aggregate(big, 'max'), 100002);
});

test('sliced unpacking gives the same dataset as the one-shot version', async () => {
  const { unpackDatasetAsync } = await import('../src/core/pack.js');
  const ds = buildDataset('t', ['n', 'c', 'b'], Array.from({ length: 250001 }, (_, i) => [String(i % 97), `k${i % 5}`, i % 2 ? 'yes' : '']));
  const { packed } = packDataset(ds);
  const seen = [];
  const back = await unpackDatasetAsync(structuredClone(packed), (f) => seen.push(f));
  assert.deepEqual(back, unpackDataset(structuredClone(packed)));
  assert.deepEqual(seen, [1 / 3, 2 / 3, 1]);
});

test('overview data: exact missing share, sampled summaries, correlation only with 2+ numbers', async () => {
  const { overviewData, evenSample, OVERVIEW_SAMPLE } = await import('../src/core/overview.js');
  assert.deepEqual(evenSample([1, 2, 3], 10), [1, 2, 3]);
  assert.equal(evenSample([...Array(1000).keys()], 10)[9], 900);
  const ov = overviewData(coffee, all(coffee));
  const temp = ov.cards[col(coffee, 'temperature_c')];
  assert.ok(temp.missingPct > 0 && temp.stats.mean > 0 && temp.bins.length > 0);
  assert.equal(ov.cards[col(coffee, 'weekday')].distinct, 7);
  assert.ok(ov.corr.names.includes('revenue'));
  assert.ok(ov.insights.length > 3);
  assert.equal(OVERVIEW_SAMPLE, 50000);
  assert.equal(overviewData(datasetFromText('a,b\nx,1\ny,2\n', 'd.csv'), [0, 1]).corr, null);
});
