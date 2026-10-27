import test from 'node:test';
import assert from 'node:assert/strict';
import { datasetFromText } from '../src/core/infer.js';
import { delayedEffect, findGroups, funnel, predictWhatIf, returnRates, trendAndPattern, whatIfModel } from '../src/core/analyses-more.js';

const ds = (text) => datasetFromText(text, 'test.csv');
const all = (d) => [...Array(d.rowCount).keys()];

test('natural groups: separates clear clusters and describes them', () => {
  const rows = ['id,spend,visits,age'];
  for (let k = 0; k < 60; k++) {
    const big = k % 3 === 0;
    rows.push(`${k + 1},${big ? 500 + (k % 7) * 10 : 50 + (k % 5) * 5},${big ? 20 + (k % 3) : 2 + (k % 2)},${30 + (k % 10)}`);
  }
  const d = ds(rows.join('\n'));
  const r = findGroups(d, all(d));
  assert.ok(!r.columns.includes('id'), 'row numbers are not a measurement');
  assert.equal(r.k, 2);
  assert.equal(r.groups[0].size, 40);
  assert.match(r.groups[1].name, /high (spend|visits)/);
  assert.equal(r.labels.filter((l) => l === 'Group 2').length, 20);
  assert.equal(r.quality, 'clearly separated');
  assert.equal(JSON.stringify(findGroups(d, all(d)).labels), JSON.stringify(r.labels), 'same data, same groups');
});

test('what-if recovers effects and predicts', () => {
  const rows = ['temp,weekend,area,customers'];
  for (let k = 0; k < 80; k++) {
    const temp = 5 + (k % 20);
    const weekend = k % 7 >= 5;
    const area = ['Town', 'Beach', 'Park'][k % 3];
    const customers = 100 + 4 * temp + (weekend ? 50 : 0) + (area === 'Beach' ? 30 : 0) + ((k * 13) % 5) - 2;
    rows.push(`${temp},${weekend ? 'yes' : 'no'},${area},${customers}`);
  }
  const d = ds(rows.join('\n'));
  const m = whatIfModel(d, all(d), { target: 'customers' });
  assert.ok(m.r2 > 0.98, String(m.r2));
  const temp = m.inputs.find((s) => s.name === 'temp');
  assert.ok(Math.abs(temp.coef - 4) < 0.2, String(temp.coef));
  const area = m.inputs.find((s) => s.name === 'area');
  assert.ok(Math.abs(area.effects.Beach - area.effects.Town - 30) < 2);
  const p = predictWhatIf(m, { temp: 20, weekend: 'yes', area: 'Beach' });
  assert.ok(Math.abs(p.value - (100 + 80 + 50 + 30)) < 3, String(p.value));
  assert.ok(p.lo < p.value && p.hi > p.value);
  assert.match(m.answer, /explain well/);
});

test('return rates by first month', () => {
  const rows = ['customer,date'];
  // Jan: 4 new (2 return in Feb, 1 in Mar). Feb: 2 new (1 returns in Mar).
  const visits = [['a', '2024-01-03'], ['b', '2024-01-05'], ['c', '2024-01-09'], ['d', '2024-01-20'], ['a', '2024-02-02'], ['b', '2024-02-11'], ['a', '2024-03-02'],
    ['e', '2024-02-05'], ['f', '2024-02-08'], ['e', '2024-03-15']];
  for (const [c, t] of visits) rows.push(`${c},${t}`);
  const d = ds(rows.join('\n'));
  const r = returnRates(d, all(d), { customer: 'customer' });
  assert.equal(r.table.length, 2);
  assert.deepEqual(r.table[0].rates.slice(0, 2), [0.5, 0.25]);
  assert.equal(r.table[1].rates[0], 0.5);
  assert.ok(Math.abs(r.average[0] - 0.5) < 1e-9);
  assert.match(r.answer, /50% of new customer values come back/);
});

test('funnel counts each step and the biggest drop', () => {
  const rows = ['visited,signed_up,bought'];
  for (let k = 0; k < 100; k++) rows.push(`${k < 90 ? 'yes' : 'no'},${k < 30 ? 'yes' : 'no'},${k < 12 ? 'yes' : 'no'}`);
  const d = ds(rows.join('\n'));
  const r = funnel(d, all(d));
  assert.deepEqual(r.steps, ['visited', 'signed_up', 'bought']);
  assert.deepEqual(r.stages.map((s) => s.count), [100, 90, 30, 12]);
  assert.match(r.answer, /biggest drop is from “visited” to “signed_up”: 67% are lost/);
});

test('trend and weekly pattern', () => {
  const rows = ['date,sales'];
  const start = Date.UTC(2024, 0, 1);
  for (let k = 0; k < 180; k++) {
    const t = new Date(start + k * 86400000);
    const sat = t.getUTCDay() === 6;
    rows.push(`${t.toISOString().slice(0, 10)},${Math.round((100 + k) * (sat ? 1.6 : 1))}`);
  }
  const d = ds(rows.join('\n'));
  const r = trendAndPattern(d, all(d), { measure: 'sales' });
  assert.match(r.answer, /is rising by about \d+% a month/);
  assert.match(r.answer, /Saturdays are busiest/);
  assert.equal(r.weekly[0].day, 'Mon');
  assert.equal(r.patternChart.bars.length, 7);
});

test('delayed effect finds the lag', () => {
  const rows = ['date,rain,customers'];
  const start = Date.UTC(2024, 0, 1);
  const rain = Array.from({ length: 60 }, (_, k) => ((k * 37) % 11));
  for (let k = 0; k < 60; k++) {
    const t = new Date(start + k * 86400000).toISOString().slice(0, 10);
    rows.push(`${t},${rain[k]},${300 - 12 * (k ? rain[k - 1] : 5) + (k % 3)}`);
  }
  const d = ds(rows.join('\n'));
  const r = delayedEffect(d, all(d), { cause: 'rain', effect: 'customers' });
  assert.equal(r.best.lag, 1);
  assert.ok(r.best.r < -0.9);
  assert.match(r.answer, /strongly related to rain 1 day later/);
});
