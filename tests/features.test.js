import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

import { datasetFromText, buildDataset } from '../src/core/infer.js';
import { FormulaError, evaluateFormula, parseFormula } from '../src/core/formula.js';
import { applyStep, describeStep, duplicateRows, runRecipe, StepError } from '../src/core/clean.js';
import {
  chiSquareTest, correlationTest, gammaP, incompleteBeta, oneWayAnova, tCritical, testColumns, tPValue, welchTTest,
} from '../src/core/significance.js';
import { excelSerialToISO, readXlsx } from '../src/core/xlsx.js';
import { sampleCSV } from '../src/core/samples.js';

const ds = () => datasetFromText('name,price,qty,date,member\nTea,2.5,4,2024-03-04,yes\nCake,4,,2024-03-05,no\nTea,2.5,4,2024-03-04,yes\nPie,3,2,,no\n', 'shop.csv');

// ---------- formulas ----------

test('formulas: arithmetic, precedence and functions', () => {
  const d = ds();
  assert.deepEqual(evaluateFormula('price * qty', d), [10, null, 10, 6]);
  assert.deepEqual(evaluateFormula('1 + 2 * 3 ^ 2', d, [0]), [19]);
  assert.deepEqual(evaluateFormula('2 ^ 3 ^ 2', d, [0]), [512]);
  assert.deepEqual(evaluateFormula('10 - 4 - 3', d, [0]), [3]);
  assert.deepEqual(evaluateFormula('-price + 1', d, [0]), [-1.5]);
  assert.deepEqual(evaluateFormula('round(price / 3, 2)', d, [0]), [0.83]);
  assert.deepEqual(evaluateFormula('coalesce(qty, 0)', d), [4, 0, 4, 2]);
  assert.deepEqual(evaluateFormula('qty / 0', d, [0]), [null]);
});

test('formulas: text, logic, dates and column references', () => {
  const d = ds();
  assert.deepEqual(evaluateFormula('if(price > 2.75 and not member, "pricey", "ok")', d), ['ok', 'pricey', 'ok', 'pricey']);
  assert.deepEqual(evaluateFormula('upper(name) & "!"', d, [0]), ['TEA!']);
  assert.deepEqual(evaluateFormula('name = "tea"', d, [0, 1]), [true, false]);
  assert.deepEqual(evaluateFormula('weekday(date)', d, [0, 3]), ['Mon', null]);
  assert.deepEqual(evaluateFormula('year(date) * 100 + month(date)', d, [0]), [202403]);
  assert.deepEqual(evaluateFormula('[price] + [qty]', d, [0]), [6.5]);
  assert.deepEqual(evaluateFormula('bucket(qty, 3)', d, [0, 3]), ['3–6', '0–3']);
  const spaced = datasetFromText('unit price,n\n2,3\n', 'x.csv');
  assert.deepEqual(evaluateFormula('[unit price] * n', spaced), [6]);
});

test('formulas: friendly errors', () => {
  const names = ['price', 'qty'];
  assert.throws(() => parseFormula('pricee * 2', names), (e) => e instanceof FormulaError && /Did you mean "price"/.test(e.message));
  assert.throws(() => parseFormula('prcie + 1', names), /Did you mean "price"/);
  assert.throws(() => parseFormula('zzz + 1', names), (e) => !/Did you mean/.test(e.message));
  assert.throws(() => parseFormula('foo(price)', names), /Unknown function "foo"/);
  assert.throws(() => parseFormula('price *', names), /ends too early/);
  assert.throws(() => parseFormula('price qty', names), /operator or comma missing/);
  assert.throws(() => parseFormula('round()', names), /round\(\) needs/);
  assert.throws(() => parseFormula('"open', names), /closing quote/);
  assert.throws(() => parseFormula('', names), /Type a formula/);
  assert.deepEqual(parseFormula('price * QTY', names).columns, ['price', 'qty']);
});

// ---------- cleaning steps ----------

test('cleaning: duplicates, missing values and undo by replay', () => {
  const original = ds();
  assert.deepEqual(duplicateRows(original), [2]);
  const steps = [
    { op: 'removeDuplicates' },
    { op: 'fillMissing', column: 'qty', method: 'mean' },
    { op: 'dropMissing', column: 'date' },
  ];
  const out = runRecipe(original, steps);
  assert.equal(out.rowCount, 2);
  assert.deepEqual(out.columns[2].values, [4, 3]);
  // The original is untouched, so replaying fewer steps is an undo.
  assert.equal(original.rowCount, 4);
  assert.equal(runRecipe(original, steps.slice(0, 1)).rowCount, 3);
});

test('cleaning: fill methods', () => {
  const d = datasetFromText('t,v,c\n1,10,a\n2,,a\n3,30,\n4,,b\n', 'f.csv');
  const vals = (step) => applyStep(d, step).columns[d.columns.findIndex((c) => c.name === step.column)].values;
  assert.deepEqual(vals({ op: 'fillMissing', column: 'v', method: 'median' }), [10, 20, 30, 20]);
  assert.deepEqual(vals({ op: 'fillMissing', column: 'v', method: 'previous' }), [10, 10, 30, 30]);
  assert.deepEqual(vals({ op: 'fillMissing', column: 'v', method: 'value', value: '0' }), [10, 0, 30, 0]);
  assert.deepEqual(vals({ op: 'fillMissing', column: 'c', method: 'mode' }), ['a', 'a', 'a', 'b']);
  assert.throws(() => applyStep(d, { op: 'fillMissing', column: 'c', method: 'mean' }), StepError);
  assert.throws(() => applyStep(d, { op: 'fillMissing', column: 'v', method: 'value', value: 'abc' }), /isn't a valid number/);
});

test('cleaning: rename, delete, type, text and keepRows', () => {
  let d = ds();
  d = applyStep(d, { op: 'rename', column: 'qty', to: 'quantity' });
  assert.equal(d.columns[2].name, 'quantity');
  assert.throws(() => applyStep(d, { op: 'rename', column: 'price', to: 'name' }), /already a column/);
  d = applyStep(d, { op: 'delete', column: 'member' });
  assert.equal(d.columns.length, 4);
  d = applyStep(d, { op: 'setType', column: 'price', type: 'category' });
  assert.deepEqual(d.columns[1].values, ['2.5', '4', '2.5', '3']);
  d = applyStep(d, { op: 'text', column: 'name', transform: 'upper' });
  assert.deepEqual(d.columns[0].values, ['TEA', 'CAKE', 'TEA', 'PIE']);
  d = applyStep(d, { op: 'keepRows', filters: [{ column: 'name', op: 'is', value: 'tea' }] });
  assert.equal(d.rowCount, 2);
  const titled = applyStep(datasetFromText('x\n  new   york \nSAN-josé\n', 't.csv'), { op: 'text', column: 'x', transform: 'title' });
  assert.deepEqual(titled.columns[0].raw.map((s) => s.trim()), ['New   York', 'San-José']);
});

test('cleaning: calculated columns get the right type and exact values', () => {
  let d = applyStep(ds(), { op: 'formula', name: 'total', formula: 'price * qty' });
  const total = d.columns.at(-1);
  assert.equal(total.type, 'number');
  assert.deepEqual(total.values, [10, null, 10, 6]);
  d = applyStep(d, { op: 'formula', name: 'big', formula: 'total > 8' });
  assert.equal(d.columns.at(-1).type, 'boolean');
  d = applyStep(d, { op: 'formula', name: 'tenth', formula: '0.1 + 0.2' });
  assert.deepEqual(d.columns.at(-1).raw.slice(0, 1), ['0.3']);
  assert.throws(() => applyStep(d, { op: 'formula', name: 'total', formula: '1' }), /already a column/);
  assert.match(describeStep({ op: 'formula', name: 'total', formula: 'price * qty' }), /New column total/);
});

// ---------- statistics ----------

const close = (a, b, tol = 1e-4) => assert.ok(Math.abs(a - b) < tol, `${a} ≉ ${b}`);

test('distribution functions match reference values', () => {
  close(incompleteBeta(0.5, 2, 3), 0.6875, 1e-10);
  close(gammaP(1, 1), 1 - Math.exp(-1), 1e-10);
  close(tPValue(2.228, 10), 0.05, 1e-3); // classic t-table value
  close(tCritical(10), 2.228, 1e-3);
  close(tCritical(1e6), 1.96, 1e-3);
});

test('Welch t-test, ANOVA, correlation and chi-square', () => {
  const a = [5.1, 4.9, 5.6, 5.8, 6.0, 5.5, 5.3];
  const b = [6.3, 6.6, 7.1, 6.8, 6.9, 7.4, 6.5];
  const t = welchTTest(a, b);
  assert.ok(t.p < 0.001 && t.diff < 0 && t.ci[1] < 0);
  close(welchTTest([1, 2, 3, 4], [1, 2, 3, 4]).p, 1);

  const anova = oneWayAnova([[1, 2, 3], [2, 3, 4], [10, 11, 12]]);
  close(anova.f, 73, 1e-9); // SSB = 146 (df 2), SSW = 6 (df 6)
  assert.ok(anova.p < 0.001);

  const c = correlationTest([1, 2, 3, 4, 5, 6], [2, 4, 5, 4, 5, 7]);
  close(c.r, 13.5 / Math.sqrt(17.5 * 13.5), 1e-12);
  close(c.p, 0.0213, 1e-3); // t = 3.674 with 4 df

  // 2×2 table [[30,10],[10,30]] → chi² = 20
  const x = [...Array(30).fill('a'), ...Array(10).fill('a'), ...Array(10).fill('b'), ...Array(30).fill('b')];
  const y = [...Array(30).fill('u'), ...Array(10).fill('v'), ...Array(10).fill('u'), ...Array(30).fill('v')];
  const chi = chiSquareTest(x, y);
  close(chi.chi2, 20, 1e-9);
  assert.equal(chi.df, 1);
  close(chi.p, 7.744e-6, 1e-7);
});

test('testColumns picks the right test for the column types', () => {
  const s = datasetFromText(sampleCSV('students'), 's.csv');
  const all = [...Array(s.rowCount).keys()];
  const idx = (n) => s.columns.findIndex((c) => c.name === n);
  assert.equal(testColumns(s, all, idx('hours_studied'), idx('exam_score')).test, 'Correlation test');
  assert.equal(testColumns(s, all, idx('passed'), idx('exam_score')).test, "Welch's t-test");
  assert.equal(testColumns(s, all, idx('exam_score'), idx('major')).test, 'One-way ANOVA');
  assert.equal(testColumns(s, all, idx('major'), idx('passed')).test, 'Chi-square test');
  assert.equal(testColumns(s, all, idx('major'), null), null);
  assert.ok(testColumns(s, all, idx('hours_studied'), idx('exam_score')).p < 0.001);
});

// ---------- Excel ----------

/** Build a zip archive (some entries deflated, some stored) for testing. */
function zip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const central = [];
  let offset = 0;
  Object.entries(files).forEach(([name, text], k) => {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(text);
    const method = k % 2 ? 0 : 8;
    const data = method ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(nameBytes.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  });
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

test('readXlsx reads shared strings, numbers, booleans, dates and multiple sheets', async () => {
  const file = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Sales &amp; Co" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>product</t></si><si><t>when</t></si><si><r><t>Tea</t></r><r><t xml:space="preserve"> &amp; cake</t></r></si><si><t>ok</t></si></sst>',
    'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>3</v></c><c r="D1" t="inlineStr"><is><t>price</t></is></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>45366</v></c><c r="C2" t="b"><v>1</v></c><c r="D2"><v>3.5</v></c></row>'
      + '<row r="3"/>'
      + '<row r="4"><c r="B4" s="2"><v>45366.5</v></c><c r="D4"><v>12</v></c></row>'
      + '</sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData/></worksheet>',
  });
  const sheets = await readXlsx(file);
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, 'Sales & Co');
  assert.deepEqual(sheets[0].headers, ['product', 'when', 'ok', 'price']);
  assert.deepEqual(sheets[0].rows, [['Tea & cake', '2024-03-15', 'TRUE', '3.5'], ['', '2024-03-15T12:00:00', '', '12']]);
  const d = buildDataset('x', sheets[0].headers, sheets[0].rows);
  assert.deepEqual(d.columns.map((c) => c.type), ['category', 'date', 'boolean', 'number']);
});

test('excel serial dates and invalid files', async () => {
  assert.equal(excelSerialToISO(1), '1899-12-31');
  assert.equal(excelSerialToISO(45292), '2024-01-01');
  await assert.rejects(readXlsx(new Uint8Array([1, 2, 3])), /not a valid .xlsx/);
});
