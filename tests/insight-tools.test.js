import { test } from 'node:test';
import assert from 'node:assert/strict';

import { datasetFromText } from '../src/core/infer.js';
import { sampleCSV } from '../src/core/samples.js';
import { exampleQuestions, parseQuestion } from '../src/core/ask.js';
import { canBeTarget, keyDrivers } from '../src/core/drivers.js';
import { deserializeProject, isProject, serializeProject } from '../src/core/project.js';
import { applyStep } from '../src/core/clean.js';
import { GLOSSARY, LESSONS } from '../src/core/learn.js';

const coffee = datasetFromText(sampleCSV('coffee'), 'Coffee shop sales.csv');
const students = datasetFromText(sampleCSV('students'), 'Student exam results.csv');
const col = (ds, name) => ds.columns.findIndex((c) => c.name === name);
const ask = (ds, q) => parseQuestion(q, ds);

// ---------- ask ----------

test('ask: grouped questions', () => {
  const a = ask(coffee, 'Average revenue by weekday?');
  assert.deepEqual(a.result, { type: 'summary', by: col(coffee, 'weekday'), fn: 'mean', column: col(coffee, 'revenue'), sort: null, limit: null });
  assert.match(a.understood, /Average revenue for each weekday/);

  const b = ask(students, 'Which major has the highest exam score');
  assert.equal(b.result.by, col(students, 'major'));
  assert.equal(b.result.column, col(students, 'exam_score'));
  assert.equal(b.result.sort, 'desc');
  assert.equal(b.result.limit, 1);

  const c = ask(students, 'which major has the lowest attendance');
  assert.equal(c.result.sort, 'asc');
  assert.equal(c.result.column, col(students, 'attendance_pct'), '"attendance" should match attendance_pct');

  const d = ask(students, 'top 3 majors by total practice tests');
  assert.equal(d.result.fn, 'sum');
  assert.equal(d.result.limit, 3);

  const e = ask(students, 'how many students per major');
  assert.equal(e.result.fn, 'count');
  assert.equal(e.result.by, col(students, 'major'));

  const f = ask(students, 'compare exam score by passed');
  assert.equal(f.result.by, col(students, 'passed'), 'a yes/no column after "by" is a grouping, not a filter');
  assert.deepEqual(f.filters, []);
});

test('ask: filters from conditions, category values and yes/no columns', () => {
  const a = ask(coffee, 'how many rows where rainy is yes');
  assert.deepEqual(a.result, { type: 'value', fn: 'count', column: null });
  assert.deepEqual(a.filters, [{ column: col(coffee, 'rainy'), op: 'is', value: 'yes' }]);

  const b = ask(coffee, 'total revenue on rainy days');
  assert.deepEqual(b.result, { type: 'value', fn: 'sum', column: col(coffee, 'revenue') });
  assert.deepEqual(b.filters, [{ column: col(coffee, 'rainy'), op: 'is', value: 'yes' }]);

  const c = ask(coffee, 'average customers when temperature is above 20');
  assert.deepEqual(c.filters, [{ column: col(coffee, 'temperature_c'), op: '>', value: '20' }]);
  assert.equal(c.result.column, col(coffee, 'customers'));

  const d = ask(students, 'average exam score for biology students');
  assert.deepEqual(d.filters, [{ column: col(students, 'major'), op: 'is', value: 'Biology' }]);
  assert.match(d.understood, /where major is Biology/);

  const e = ask(coffee, 'average revenue on saturdays');
  assert.deepEqual(e.filters, [{ column: col(coffee, 'weekday'), op: 'is', value: 'Sat' }]);

  const f = ask(coffee, 'average revenue on non promotion days');
  assert.deepEqual(f.filters, [{ column: col(coffee, 'promotion'), op: 'is', value: 'no' }]);
});

test('ask: charts, time and drivers', () => {
  assert.deepEqual(ask(students, 'relationship between hours studied and exam score').result,
    { type: 'chart', chart: { type: 'scatter', x: col(students, 'hours_studied'), y: col(students, 'exam_score') } });
  assert.deepEqual(ask(students, 'distribution of sleep hours').result, { type: 'chart', chart: { type: 'histogram', x: col(students, 'sleep_hours'), y: null } });
  assert.deepEqual(ask(coffee, 'revenue over time').result, { type: 'chart', chart: { type: 'line', x: col(coffee, 'date'), y: col(coffee, 'revenue') } });
  const monthly = ask(coffee, 'total iced drinks per month').result;
  assert.equal(monthly.type, 'summary');
  assert.equal(monthly.dateUnit, 'month');
  assert.equal(monthly.fn, 'sum');
  assert.deepEqual(ask(students, 'what drives exam score?').result, { type: 'drivers', target: col(students, 'exam_score') });
  assert.deepEqual(ask(students, 'major').result, { type: 'summary', by: col(students, 'major'), fn: 'count', column: null, sort: null, limit: null });
});

test('ask: helpful failure with real example questions', () => {
  const a = ask(students, 'what is the weather like');
  assert.ok(a.error);
  assert.ok(a.suggestions.length >= 4);
  for (const s of exampleQuestions(students)) assert.ok(!parseQuestion(s, students).error, `example "${s}" should be understood`);
  for (const s of exampleQuestions(coffee)) assert.ok(!parseQuestion(s, coffee).error, `example "${s}" should be understood`);
  assert.ok(ask(coffee, '').error);
});

// ---------- key drivers ----------

test('key drivers rank the real relationships first and skip ID columns', () => {
  const d = keyDrivers(students, [...Array(students.rowCount).keys()], col(students, 'exam_score'));
  assert.equal(d[0].column, 'passed', 'passed is derived from the score, so it should top the list');
  assert.ok(d.findIndex((x) => x.column === 'hours_studied') < d.findIndex((x) => x.column === 'sleep_hours'));
  assert.ok(!d.some((x) => x.column === 'student_id'));
  for (let i = 1; i < d.length; i++) assert.ok(d[i - 1].strength >= d[i].strength);
  assert.match(d.find((x) => x.column === 'hours_studied').sentence, /higher hours_studied tend to have higher exam_score/);

  const iced = keyDrivers(coffee, [...Array(coffee.rowCount).keys()], col(coffee, 'iced_drinks'));
  assert.equal(iced.find((x) => x.method === 'correlation').column, 'temperature_c');

  // Categorical target
  assert.ok(canBeTarget(students.columns[col(students, 'passed')]));
  assert.ok(!canBeTarget(students.columns[col(students, 'student_id')]));
  const passed = keyDrivers(students, [...Array(students.rowCount).keys()], col(students, 'passed'));
  assert.equal(passed[0].column, 'exam_score');
});

// ---------- projects ----------

test('projects round-trip data, steps, settings and report through JSON', () => {
  const steps = [{ op: 'fillMissing', column: 'temperature_c', method: 'median' }, { op: 'formula', name: 'per_customer', formula: 'revenue / customers' }];
  const view = { chart: { type: 'scatter', x: 'temperature_c', y: 'iced_drinks' }, filters: [{ column: 'rainy', op: 'is', value: 'yes' }] };
  const report = [{ id: 'r1', kind: 'text', title: 'Notes', note: 'Hello' }];
  const json = JSON.parse(JSON.stringify(serializeProject({ id: 'p1', original: coffee, steps, view, report, appVersion: '0.4.0' })));
  assert.ok(isProject(json));
  const back = deserializeProject(json);
  assert.equal(back.original.rowCount, coffee.rowCount);
  assert.deepEqual(back.original.columns.map((c) => c.type), coffee.columns.map((c) => c.type));
  assert.equal(back.dataset.columns.at(-1).name, 'per_customer');
  assert.equal(back.dataset.columns[col(coffee, 'temperature_c')].values.filter((v) => v == null).length, 0);
  assert.deepEqual(back.view, view);
  assert.deepEqual(back.report, report);
  assert.equal(back.skippedSteps, 0);
});

test('projects keep working when a step no longer applies, and reject bad files', () => {
  const json = serializeProject({ id: 'p2', original: coffee, steps: [{ op: 'delete', column: 'no_such_column' }, { op: 'removeDuplicates' }], view: {}, report: [], appVersion: '0.4.0' });
  const back = deserializeProject(json);
  assert.equal(back.skippedSteps, 1);
  assert.deepEqual(back.steps, [{ op: 'removeDuplicates' }]);
  assert.throws(() => deserializeProject({ hello: 1 }), /not a Lumora project/);
  assert.throws(() => deserializeProject({ ...json, schema: 99 }), /newer version/);
  // Same data after a type change step: still restores.
  const typed = applyStep(coffee, { op: 'setType', column: 'customers', type: 'category' });
  assert.equal(typed.columns[col(coffee, 'customers')].type, 'category');
});

test('ask and drivers lessons point at real questions and columns', () => {
  for (const lesson of LESSONS) {
    const ds = lesson.try.sample === 'coffee' ? coffee : students;
    if (lesson.try.ask) assert.ok(!parseQuestion(lesson.try.ask, ds).error, `${lesson.id}: question not understood`);
    if (lesson.try.drivers) assert.ok(col(ds, lesson.try.drivers) >= 0, `${lesson.id}: unknown column`);
  }
  for (const key of ['ask', 'drivers', 'report']) assert.ok(GLOSSARY[key], key);
});
