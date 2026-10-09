import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectDelimiter, parseCSV } from '../src/core/csv.js';
import { datasetFromText, inferType, parseDate, parseNumber, setColumnType } from '../src/core/infer.js';
import { describe, histogram, linearRegression, niceTicks, pearson, quantileSorted } from '../src/core/stats.js';
import { applyFilters, datasetToCSV, formatNumber, groupBy, sortIndices, toCSV } from '../src/core/transform.js';
import { generateInsights } from '../src/core/insights.js';
import { buildChartData, suggestChart } from '../src/core/chartspec.js';
import { SAMPLES, sampleCSV } from '../src/core/samples.js';
import { GLOSSARY, LESSONS } from '../src/core/learn.js';

test('parseCSV handles quotes, escaped quotes, newlines in fields and CRLF', () => {
  const text = 'name,note\r\n"Smith, J","said ""hi"""\r\n"multi\nline",x\r\n\r\n';
  assert.deepEqual(parseCSV(text), [['name', 'note'], ['Smith, J', 'said "hi"'], ['multi\nline', 'x']]);
});

test('detectDelimiter picks the consistent separator', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3\n4;5;6'), ';');
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(detectDelimiter('a,b\n"1;2",3'), ',');
});

test('parseNumber understands common formats', () => {
  assert.equal(parseNumber('1,234.5'), 1234.5);
  assert.equal(parseNumber('$20'), 20);
  assert.equal(parseNumber('-3.5e2'), -350);
  assert.equal(parseNumber('45%'), 45);
  assert.equal(parseNumber('12abc'), null);
  assert.equal(parseNumber('1,23'), null);
});

test('parseDate understands ISO, slashes and rejects invalid dates', () => {
  assert.equal(parseDate('2024-03-05'), Date.UTC(2024, 2, 5));
  assert.equal(parseDate('03/05/2024'), Date.UTC(2024, 2, 5));
  assert.equal(parseDate('25/12/2024'), Date.UTC(2024, 11, 25));
  assert.equal(parseDate('2023-02-31'), null);
  assert.equal(parseDate('hello'), null);
});

test('inferType classifies columns', () => {
  assert.equal(inferType(['1', '2', '3.5', '']), 'number');
  assert.equal(inferType(['2024-01-01', '2024-02-01']), 'date');
  assert.equal(inferType(['yes', 'no', 'Yes']), 'boolean');
  assert.equal(inferType(['red', 'blue', 'red', 'red', 'blue']), 'category');
  const sentences = Array.from({ length: 60 }, (_, i) => `This is a fairly long free-text comment number ${i}`);
  assert.equal(inferType(sentences), 'text');
});

test('datasetFromText builds typed columns and handles missing values', () => {
  const ds = datasetFromText('city,temp,date\nOslo,3,2024-01-01\nRome,NA,2024-01-02\nOslo,12,2024-01-03\n', 'w.csv');
  assert.equal(ds.name, 'w');
  assert.equal(ds.rowCount, 3);
  assert.deepEqual(ds.columns.map((c) => c.type), ['category', 'number', 'date']);
  assert.deepEqual(ds.columns[1].values, [3, null, 12]);
  setColumnType(ds, 1, 'category');
  assert.deepEqual(ds.columns[1].values, ['3', null, '12']);
});

test('datasetFromText reads JSON arrays and fixes duplicate/blank headers', () => {
  const ds = datasetFromText('[{"a":1,"b":"x"},{"a":2,"c":true}]', 'd.json');
  assert.deepEqual(ds.columns.map((c) => c.name), ['a', 'b', 'c']);
  assert.deepEqual(ds.columns[0].values, [1, 2]);
  const dup = datasetFromText('x,x,\n1,2,3\n', 'd.csv');
  assert.deepEqual(dup.columns.map((c) => c.name), ['x', 'x (2)', 'Column 3']);
});

test('describe computes summary statistics', () => {
  const d = describe([1, 2, 3, 4, 100]);
  assert.equal(d.count, 5);
  assert.equal(d.mean, 22);
  assert.equal(d.median, 3);
  assert.equal(d.q1, 2);
  assert.equal(d.q3, 4);
  assert.equal(d.outliers, 1);
  assert.ok(d.skew > 1);
  assert.equal(quantileSorted([10, 20], 0.5), 15);
});

test('niceTicks and histogram produce round edges covering all values', () => {
  assert.deepEqual(niceTicks(0, 97, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(0.1, 0.3, 2), [0.1, 0.2, 0.3]);
  assert.deepEqual(niceTicks(0.13, 0.91, 4), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  const xs = Array.from({ length: 100 }, (_, i) => i);
  const bins = histogram(xs);
  assert.equal(bins.reduce((s, b) => s + b.count, 0), 100);
  assert.ok(bins[0].x0 <= 0 && bins[bins.length - 1].x1 >= 99);
});

test('pearson and linearRegression', () => {
  const x = [1, 2, 3, 4, 5];
  assert.ok(Math.abs(pearson(x, [2, 4, 6, 8, 10]) - 1) < 1e-12);
  assert.ok(Math.abs(pearson(x, [5, 4, 3, 2, 1]) + 1) < 1e-12);
  assert.ok(Number.isNaN(pearson(x, [1, 1, 1, 1, 1])));
  const reg = linearRegression(x, [3, 5, 7, 9, null]);
  assert.equal(reg.slope, 2);
  assert.equal(reg.intercept, 1);
  assert.equal(reg.r2, 1);
});

test('filters, sorting and grouping', () => {
  const ds = datasetFromText('team,score,active\nA,10,yes\nB,30,no\nA,20,yes\nB,,yes\n', 't.csv');
  assert.deepEqual(applyFilters(ds, [{ column: 1, op: '>', value: '15' }]), [1, 2]);
  assert.deepEqual(applyFilters(ds, [{ column: 0, op: 'is', value: 'a' }]), [0, 2]);
  assert.deepEqual(applyFilters(ds, [{ column: 1, op: 'is missing' }]), [3]);
  assert.deepEqual(applyFilters(ds, [{ column: 2, op: 'is', value: 'yes' }, { column: 0, op: 'is', value: 'B' }]), [3]);
  // Incomplete filters are ignored rather than hiding everything.
  assert.deepEqual(applyFilters(ds, [{ column: 1, op: '>', value: '' }]), [0, 1, 2, 3]);
  assert.deepEqual(sortIndices(ds, [0, 1, 2, 3], 1, 'desc'), [1, 2, 0, 3]);

  const g = groupBy(ds, [0, 1, 2, 3], { by: 0, aggs: [{ fn: 'count' }, { fn: 'mean', column: 1 }, { fn: 'mean', column: 2 }] });
  assert.deepEqual(g.headers, ['team', 'Rows', 'Average (mean) of score', 'Average (mean) of active']);
  assert.deepEqual(g.rows, [['A', 2, 15, 1], ['B', 2, 30, 0.5]]);
});

test('grouping dates by month and weekday', () => {
  const ds = datasetFromText('d,v\n2024-01-01,1\n2024-01-15,3\n2024-02-01,5\n', 'd.csv');
  assert.deepEqual(groupBy(ds, [0, 1, 2], { by: 0, dateUnit: 'month', aggs: [{ fn: 'sum', column: 1 }] }).rows, [['2024-01', 4], ['2024-02', 5]]);
  assert.deepEqual(groupBy(ds, [0, 1, 2], { by: 0, dateUnit: 'weekday', aggs: [{ fn: 'count' }] }).rows.map((r) => r[0]), ['Mon', 'Thu']);
});

test('CSV export round-trips tricky values', () => {
  const csv = toCSV(['a', 'b'], [['x,y', 'say "hi"'], [null, 2]]);
  assert.equal(csv, 'a,b\n"x,y","say ""hi"""\n,2\n');
  const ds = datasetFromText(csv, 'r.csv');
  assert.equal(datasetToCSV(ds, [0, 1]), csv);
});

test('formatNumber is readable', () => {
  assert.equal(formatNumber(1234567.891), '1,234,567.9');
  assert.equal(formatNumber(3.14159), '3.14');
  assert.equal(formatNumber(0.012345), '0.0123');
  assert.equal(formatNumber(null), '–');
});

test('suggestChart picks a chart that fits the column types', () => {
  const num = { name: 'n', type: 'number' };
  const cat = { name: 'c', type: 'category' };
  const date = { name: 'd', type: 'date' };
  assert.equal(suggestChart(num).type, 'histogram');
  assert.equal(suggestChart(cat).type, 'bar');
  assert.equal(suggestChart(date).type, 'line');
  assert.equal(suggestChart(num, num).type, 'scatter');
  assert.equal(suggestChart(date, num).type, 'line');
  assert.equal(suggestChart(cat, num).type, 'bar');
  assert.equal(suggestChart(num, cat).type, 'box');
});

test('sample datasets load and every chart type renders data for them', () => {
  for (const s of SAMPLES) {
    const ds = datasetFromText(sampleCSV(s.id), `${s.name}.csv`);
    assert.ok(ds.rowCount >= 100, s.id);
    const all = [...Array(ds.rowCount).keys()];
    const nums = ds.columns.map((c, i) => (c.type === 'number' ? i : -1)).filter((i) => i >= 0);
    const [num, num2] = nums;
    const date = ds.columns.findIndex((c) => c.type === 'date');
    const cat = ds.columns.findIndex((c) => c.type === 'category');
    for (const [type, x, y] of [['histogram', num, null], ['bar', cat, num], ['scatter', num, num2], ['box', cat, num], ['box', num, cat], ['line', num, num2], ['bar', cat, null], ...(date >= 0 ? [['line', date, num], ['line', date, null]] : [])]) {
      const data = buildChartData(ds, all, { type, x, y, agg: 'mean' });
      assert.ok(!data.error, `${s.id} ${type}: ${data.error}`);
    }
  }
});

test('sample data has the intended types and patterns for lessons', () => {
  const coffee = datasetFromText(sampleCSV('coffee'), 'coffee.csv');
  const type = (name) => coffee.columns.find((c) => c.name === name).type;
  assert.equal(type('date'), 'date');
  assert.equal(type('weekday'), 'category');
  assert.equal(type('rainy'), 'boolean');
  const col = (name) => coffee.columns.find((c) => c.name === name).values;
  assert.ok(pearson(col('temperature_c'), col('iced_drinks')) > 0.7);

  const insights = generateInsights(coffee);
  assert.ok(insights.some((i) => i.term === 'missing' && i.kind === 'warning'));
  assert.ok(insights.some((i) => i.term === 'correlation'));
});

test('every lesson refers to real columns and glossary terms', () => {
  for (const lesson of LESSONS) {
    for (const t of lesson.terms) assert.ok(GLOSSARY[t], `${lesson.id}: unknown term ${t}`);
    const ds = datasetFromText(sampleCSV(lesson.try.sample), 'x.csv');
    const names = ds.columns.map((c) => c.name);
    const refs = [lesson.try.chart?.x, lesson.try.chart?.y, lesson.try.summarize?.by, ...(lesson.try.summarize?.aggs ?? []).map((a) => a.column)];
    for (const r of refs.filter(Boolean)) assert.ok(names.includes(r), `${lesson.id}: unknown column ${r}`);
  }
});

test('insights handle an empty selection', () => {
  const ds = datasetFromText('a\n1\n2\n', 'a.csv');
  assert.equal(generateInsights(ds, [])[0].title, 'No rows to analyse');
});

test('movingAverage smooths a series and keeps its length', async () => {
  const { movingAverage } = await import('../src/core/chartspec.js');
  const pts = [1, 5, 1, 5, 1].map((y, x) => ({ x, y }));
  const out = movingAverage(pts, 3);
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((p) => p.y), [3, 7 / 3, 11 / 3, 7 / 3, 3]);
});
