import test from 'node:test';
import assert from 'node:assert/strict';
import { datasetFromText } from '../src/core/infer.js';
import { answerTone, bucketLabel, defaultMeasure, compareGroups, explainChange, stem, textThemes, topContributors, unusualPoints } from '../src/core/analyses.js';

const ds = (text) => datasetFromText(text, 'test.csv');
const all = (d) => [...Array(d.rowCount).keys()];

test('why did it change: total, periods and the category that explains it', () => {
  const rows = ['date,region,channel,revenue'];
  // March: North 100, South 100. April: North 40, South 105 (North drove the fall).
  for (const [d, region, channel, v] of [
    ['2024-03-02', 'North', 'Shop', 60], ['2024-03-09', 'North', 'Web', 40], ['2024-03-05', 'South', 'Shop', 50], ['2024-03-15', 'South', 'Web', 50],
    ['2024-04-02', 'North', 'Shop', 20], ['2024-04-09', 'North', 'Web', 20], ['2024-04-05', 'South', 'Shop', 55], ['2024-04-28', 'South', 'Web', 50],
    ['2024-01-10', 'North', 'Shop', 10], ['2024-02-10', 'South', 'Web', 10], ['2023-12-10', 'South', 'Web', 10], ['2023-11-10', 'South', 'Web', 10],
  ]) rows.push(`${d},${region},${channel},${v}`);
  const d = ds(rows.join('\n'));
  const r = explainChange(d, all(d), { measure: 'revenue' });
  assert.equal(r.unit, 'month');
  assert.equal(r.from, '2024-03');
  assert.equal(r.to, '2024-04');
  assert.equal(r.before, 200);
  assert.equal(r.after, 145);
  assert.equal(r.by, 'region');
  assert.deepEqual(r.parts.map((p) => [p.label, p.change]), [['North', -60], ['South', 5]]);
  assert.match(r.answer, /fell from 200 in Mar 2024 to 145 in Apr 2024 \(−?-?28%\)/);
  assert.match(r.answer, /region “North” \(−60\)/);
  assert.equal(r.chart.bars[0].tone, 'down');
  assert.equal(explainChange(d, all(d), { measure: 'revenue', by: 'channel' }).by, 'channel', 'a chosen column is respected');
  assert.ok(explainChange(ds('a,b\n1,2\n'), [0]).error);
  assert.equal(bucketLabel('2024-03-05'), 'Mar 5, 2024');
});

test('compare two groups: biggest real difference first', () => {
  const rows = ['day,weekend,customers,temp'];
  for (let k = 0; k < 40; k++) {
    const weekend = k % 7 >= 5;
    rows.push(`d${k},${weekend ? 'yes' : 'no'},${weekend ? 300 + (k % 5) * 3 : 200 + (k % 5) * 3},${15 + (k % 4)}`);
  }
  const d = ds(rows.join('\n'));
  const r = compareGroups(d, all(d), { column: 'weekend' });
  assert.equal(r.column, 'weekend');
  assert.deepEqual([r.a, r.b], ['No', 'Yes']);
  assert.equal(r.rows[0].column, 'customers');
  assert.match(r.answer, /biggest difference between “No” and “Yes” is customers/);
  assert.equal(r.rows[0].verdict, 'almost certainly real');
  assert.notEqual(r.rows[1].verdict, 'almost certainly real');
});

test('unusual days take the weekday pattern into account', () => {
  const rows = ['date,sales'];
  const start = Date.UTC(2024, 0, 1); // a Monday
  for (let k = 0; k < 70; k++) {
    const t = new Date(start + k * 86400000);
    const weekend = t.getUTCDay() === 0 || t.getUTCDay() === 6;
    let v = (weekend ? 500 : 200) + ((k * 37) % 11);
    if (k === 30) v = 900; // a Wednesday spike
    rows.push(`${t.toISOString().slice(0, 10)},${v}`);
  }
  const d = ds(rows.join('\n'));
  const r = unusualPoints(d, all(d), { measure: 'sales' });
  assert.equal(r.unit, 'day');
  assert.equal(r.flagged.length, 1, 'busy weekends are normal, only the spike stands out');
  assert.equal(r.flagged[0].key, '2024-01-31');
  assert.match(r.answer, /The most unusual is Jan 31, 2024: 900 sales/);
  assert.equal(r.chart.highlights.length, 1);
});

test('top contributors find the 80/20 split', () => {
  const rows = ['product,revenue'];
  const sizes = { A: 500, B: 300, C: 50, D: 40, E: 30, F: 20, G: 20, H: 20, I: 10, J: 10 };
  for (const [p, v] of Object.entries(sizes)) rows.push(`${p},${v}`);
  const d = ds(rows.join('\n'));
  const r = topContributors(d, all(d), { by: 'product', measure: 'revenue' });
  assert.equal(r.n80, 2);
  assert.match(r.answer, /^2 of 10 product values \(20%\) make up 80% of all revenue/);
  assert.equal(r.items[0].cumulative, 0.5);
});

test('themes and tone in written answers', () => {
  const comments = [
    'Great coffee but the wait was too long',
    'Long wait times at lunch',
    'Friendly staff and great coffee',
    'The prices are too high',
    'Pricing is not good for students',
    'Coffee was cold and the wait was long',
    'Lovely place, friendly staff',
  ];
  const d = ds(['comment', ...comments.map((c) => `"${c}"`)].join('\n'));
  const r = textThemes(d, all(d), {});
  const terms = r.themes.map((t) => t.term);
  assert.ok(terms.includes('great coffee') || terms.includes('coffee'), terms.join());
  assert.ok(terms.includes('friendly staff'), terms.join());
  assert.ok(terms.includes('wait'), terms.join());
  assert.ok(terms.some((t) => t.startsWith('pric')), `price and pricing count together: ${terms.join()}`);
  assert.equal(answerTone('not good at all'), -1);
  assert.equal(answerTone('Great and friendly'), 1);
  assert.equal(answerTone('It was a Tuesday'), 0);
  assert.equal(stem('prices'), stem('pricing'));
  assert.ok(r.tone.positive >= 2 && r.tone.negative >= 2);
  assert.ok(textThemes(ds('n\n1\n2\n'), [0, 1]).error);
});

test('the default measure is the money column, never an ID', () => {
  assert.equal(defaultMeasure(ds('order_id,customers,revenue\n1,3,20\n2,4,30\n')), 'revenue');
  assert.equal(defaultMeasure(ds('id,visits\n1,3\n2,4\n')), 'visits');
  assert.equal(defaultMeasure(ds('id,name\n1,a\n')), undefined, 'no measure: count rows');
});

test('compare warns about Simpson’s paradox', () => {
  // Treatment A looks better overall, but B is better for both easy and hard cases.
  const rows = ['treatment,difficulty,recovery'];
  const add = (t, dfc, n, v) => { for (let k = 0; k < n; k++) rows.push(`${t},${dfc},${v + (k % 3)}`); };
  add('A', 'easy', 40, 80); add('A', 'hard', 10, 40);
  add('B', 'easy', 10, 85); add('B', 'hard', 40, 45);
  const d = ds(rows.join('\n'));
  const r = compareGroups(d, all(d), { column: 'treatment' });
  assert.equal(r.rows[0].column, 'recovery');
  assert.ok(r.rows[0].diff > 0, 'A is higher overall');
  assert.match(r.warning, /within every difficulty group it is lower.*Simpson's paradox/);
});
