import test from 'node:test';
import assert from 'node:assert/strict';
import { datasetFromText } from '../src/core/infer.js';
import { applyStep, binLabel, describeStep, duplicateRows, niceBinSize, runRecipe } from '../src/core/clean.js';
import { healthCheck, healthScore, spellingVariants } from '../src/core/health.js';
import { makeRecipe, recipeFits, recipeSteps, requiredColumns, isRecipe } from '../src/core/recipe.js';
import { fuzzyScore, rankCommands } from '../src/core/palette.js';
import { groupBy } from '../src/core/transform.js';
import { buildChartData } from '../src/core/chartspec.js';

const ds = (text) => datasetFromText(text, 'test.csv');
const col = (d, name) => d.columns.find((c) => c.name === name);

test('find and replace: whole value (ignoring case) or text inside values', () => {
  const d = ds('city,n\nNYC,1\nnyc,2\nBoston,3\n New York ,4\n');
  const whole = applyStep(d, { op: 'replace', column: 'city', find: 'nyc', replace: 'New York', match: 'exact' });
  assert.deepEqual(col(whole, 'city').values, ['New York', 'New York', 'Boston', 'New York']);
  const inside = applyStep(d, { op: 'replace', column: 'city', find: 'o', replace: '0', match: 'contains' });
  assert.deepEqual(col(inside, 'city').values, ['NYC', 'nyc', 'B0st0n', 'New Y0rk']);
  // Special regex characters are taken literally, and "$&" in the replacement stays as typed.
  const money = applyStep(ds('p\n$5\n$6\n'), { op: 'replace', column: 'p', find: '$', replace: '$&', match: 'contains' });
  assert.deepEqual(money.columns[0].raw, ['$&5', '$&6']);
  assert.match(describeStep({ op: 'replace', column: 'city', find: 'nyc', replace: '', match: 'exact' }), /with nothing/);
});

test('split a column into parts next to the original; the last part keeps the rest', () => {
  const d = ds('name,place\nAda,"London, UK"\nBob,"Paris, Île-de-France, FR"\nCy,\n');
  const out = applyStep(d, { op: 'split', column: 'place', by: ',' });
  assert.deepEqual(out.columns.map((c) => c.name), ['name', 'place', 'place 1', 'place 2', 'place 3']);
  assert.deepEqual(col(out, 'place 1').raw, ['London', 'Paris', '']);
  assert.deepEqual(col(out, 'place 3').raw, ['', 'FR', '']);
  assert.throws(() => applyStep(d, { op: 'split', column: 'name', by: ';' }), /nothing to split/);
});

test('group numbers into readable ranges and categories into top N + Other', () => {
  assert.equal(niceBinSize(0, 97), 20);
  assert.equal(binLabel(37, 10, 0), '30 – 40');
  assert.equal(binLabel(40, 10, 0), '40 – 50');
  const d = ds('age,id\n3,a\n17,b\n25,c\n41,d\n68,e\n,f\n');
  const out = applyStep(d, { op: 'group', column: 'age', name: 'age group', method: 'bins', size: 20 });
  assert.deepEqual(col(out, 'age group').values, ['0 – 20', '0 – 20', '20 – 40', '40 – 60', '60 – 80', null]);
  assert.equal(out.columns[1].name, 'age group', 'placed next to the original');
  const g = groupBy(out, [...Array(out.rowCount).keys()], { by: 1, aggs: [{ fn: 'count' }] });
  assert.deepEqual(g.rows.map((r) => r[0]), ['0 – 20', '20 – 40', '40 – 60', '60 – 80', '(missing)'], 'ranges keep numeric order');

  const c = ds('fruit\napple\napple\napple\npear\npear\nfig\nkiwi\n');
  const top = applyStep(c, { op: 'group', column: 'fruit', name: 'fruit (top 2)', method: 'top', keep: 2 });
  assert.deepEqual(col(top, 'fruit (top 2)').values, ['apple', 'apple', 'apple', 'pear', 'pear', 'Other', 'Other']);
  assert.throws(() => applyStep(c, { op: 'group', column: 'fruit', name: 'fruit', method: 'top', keep: 2 }), /already a column/);
});

test('date parts: new columns that sort in calendar order', () => {
  const d = ds('when,v\n2024-03-04,1\n2024-01-15,2\n2024-12-31,3\n2024-03-06,4\n');
  const month = applyStep(d, { op: 'dateParts', column: 'when', part: 'month', name: 'month' });
  assert.deepEqual(col(month, 'month').values, ['Mar', 'Jan', 'Dec', 'Mar']);
  const g = groupBy(month, [0, 1, 2, 3], { by: 1, aggs: [{ fn: 'count' }] });
  assert.deepEqual(g.rows.map((r) => r[0]), ['Jan', 'Mar', 'Dec'], 'months in calendar order, not by size');
  const bars = buildChartData(month, [0, 1, 2, 3], { type: 'bar', x: 1 });
  assert.deepEqual(bars.bars.map((b) => b.label), ['Jan', 'Mar', 'Dec']);
  const y = applyStep(d, { op: 'dateParts', column: 'when', part: 'year', name: 'year' });
  assert.equal(col(y, 'year').type, 'number');
  assert.deepEqual(col(applyStep(d, { op: 'dateParts', column: 'when', part: 'weekday', name: 'wd' }), 'wd').values, ['Mon', 'Mon', 'Tue', 'Wed']);
  assert.deepEqual(col(applyStep(d, { op: 'dateParts', column: 'when', part: 'quarter', name: 'q' }), 'q').values, ['Q1', 'Q1', 'Q4', 'Q1']);
  assert.throws(() => applyStep(d, { op: 'dateParts', column: 'v', part: 'year', name: 'x' }), /isn't a date/);
});

test('remove duplicates by chosen columns (ignoring case and spaces)', () => {
  const d = ds('email,day\na@x.com,1\nA@x.com ,2\nb@x.com,3\n');
  assert.deepEqual(duplicateRows(d), []);
  assert.deepEqual(duplicateRows(d, ['email']), [1]);
  assert.equal(applyStep(d, { op: 'removeDuplicates', columns: ['email'] }).rowCount, 2);
});

test('health check finds problems and its safe fixes repair them', () => {
  const d = ds([
    'state,amount,notes,blank,same',
    'NY,10,ok,,x',
    'ny,20,ok,,x',
    ' NY ,30,ok,,x',
    'CA,n/a?,ok,,x',
    'CA,40,ok,,x',
    'CA,40,ok,,x',
    'TX,50,  hi ,,x',
  ].join('\n'));
  const issues = healthCheck(d);
  const ids = issues.map((i) => i.id);
  for (const id of ['duplicates', 'variants:state', 'type:amount', 'empty:blank', 'constant:same']) assert.ok(ids.includes(id), `expected ${id} in ${ids}`);
  assert.equal(issues[0].severity, 'high', 'most serious first');
  assert.ok(healthScore(issues) < 100);
  const variants = issues.find((i) => i.id === 'variants:state');
  assert.deepEqual(variants.fix.map, { ny: 'NY', ' NY ': 'NY' });

  const safe = issues.filter((i) => i.safe).map((i) => i.fix);
  const fixed = runRecipe(d, safe);
  assert.deepEqual([...new Set(col(fixed, 'state').values)], ['NY', 'CA', 'TX']);
  assert.ok(!fixed.columns.some((c) => c.name === 'blank'));
  const after = healthCheck(fixed).map((i) => i.id);
  assert.ok(!after.includes('variants:state') && !after.includes('duplicates') && !after.includes('empty:blank'), after.join());
  assert.equal(healthScore([]), 100);
});

test('spelling variants pick the most common spelling', () => {
  const d = ds('c\nApple\napple\napple\nPear\n');
  assert.deepEqual(spellingVariants(d.columns[0]), [{ to: 'apple', variants: ['Apple'], rows: 1 }]);
});

test('recipes: portable steps, required columns and fit', () => {
  const steps = [
    { op: 'rename', column: 'amt', to: 'amount' },
    { op: 'fillMissing', column: 'amount', method: 'median' },
    { op: 'split', column: 'place', by: ',' },
    { op: 'text', column: 'place 1', transform: 'trim' },
    { op: 'group', column: 'amount', name: 'band', method: 'bins' },
    { op: 'keepRows', filters: [{ column: 'band', op: 'is', value: '0 – 20' }, { column: 'region', op: 'is', value: 'N' }] },
    { op: 'append', data: { name: 'other', rows: [] } },
  ];
  const r = makeRecipe(steps, 'jan');
  assert.ok(isRecipe(r));
  assert.equal(r.steps.length, 6);
  assert.equal(r.skipped, 1);
  assert.deepEqual(requiredColumns(r.steps).sort(), ['amt', 'place', 'region']);
  assert.equal(recipeFits(r, ds('amt,place,region\n1,"a,b",N\n')).fits, true);
  assert.deepEqual(recipeFits(r, ds('amt,place\n1,a\n')).missing, ['region']);
  assert.ok(!isRecipe({ steps: [] }));
});

test('recipes remember column types, so a messier file is cleaned the same way', () => {
  const jan = ds('amount\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n16\n17\n18\n19\nn/a?\n');
  assert.equal(jan.columns[0].type, 'number');
  const recipe = makeRecipe([{ op: 'fillMissing', column: 'amount', method: 'median' }], 'jan', jan);
  const feb = ds('amount\n1\n2\n3\nunknown\nn/a?\n');
  assert.notEqual(feb.columns[0].type, 'number', 'too many bad values to be read as numbers on its own');
  const out = runRecipe(feb, recipeSteps(recipe, feb));
  assert.deepEqual(out.columns[0].values, [1, 2, 3, 2, 2]);
  assert.equal(JSON.parse(JSON.stringify(recipe)).types.amount, 'number', 'survives saving to a file');
});

test('command palette matching', () => {
  assert.ok(fuzzyScore('chart', 'Chart') > fuzzyScore('chart', 'Open in chart builder'));
  assert.ok(fuzzyScore('exc', 'Export table to Excel') != null);
  assert.equal(fuzzyScore('xyz', 'Chart'), null);
  assert.ok(fuzzyScore('rd', 'Remove duplicates') > 0, 'initials match');
  const cmds = [{ title: 'Go to Chart' }, { title: 'Undo' }, { title: 'Save project', keywords: 'download file' }];
  assert.deepEqual(rankCommands(cmds, 'download').map((c) => c.title), ['Save project']);
  assert.equal(rankCommands(cmds, '').length, 3);
  assert.deepEqual(rankCommands([{ title: 'Overview', keywords: 'tab overview' }], 'chart amount'), [], 'keywords that do not match never count');
});
