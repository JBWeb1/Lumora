import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATES, checkResponse, decodeForm, encodeForm, encodeResponse, mergeResponses, newField, newForm, newResponse,
  normalizeAnswer, readResponses, responsesFile, responsesToDataset, sanitizeForm, shareLink, summarizeField,
} from '../src/core/forms.js';

function sampleForm() {
  const form = newForm('Café survey', [
    { ...newField('rating', 'Overall'), required: true },
    { ...newField('choice', 'Visit'), options: ['Breakfast', 'Lunch'] },
    { ...newField('checkboxes', 'Ordered'), options: ['Coffee', 'Cake', 'Sandwich'] },
    newField('yesno', 'Return?'),
    { ...newField('number', 'Spent'), min: 0 },
    newField('date', 'When'),
    newField('email', 'Email'),
    newField('paragraph', 'Comments'),
  ]);
  return form;
}

test('answers are checked and cleaned', () => {
  const [rating, choice, boxes, yesno, num, date, email] = sampleForm().fields;
  assert.deepEqual(normalizeAnswer(rating, ''), { error: 'This question needs an answer.' });
  assert.deepEqual(normalizeAnswer(rating, '4'), { value: 4 });
  assert.ok(normalizeAnswer(rating, 6).error);
  assert.ok(normalizeAnswer(choice, 'Dinner').error);
  assert.deepEqual(normalizeAnswer(boxes, ['Sandwich', 'Coffee', 'Hacked']), { value: ['Coffee', 'Sandwich'] }, 'kept in option order, unknown dropped');
  assert.deepEqual(normalizeAnswer(yesno, 'no'), { value: false });
  assert.deepEqual(normalizeAnswer(num, '$1,250.5'), { value: 1250.5 });
  assert.ok(normalizeAnswer(num, '-3').error, 'min respected');
  assert.deepEqual(normalizeAnswer(date, '2026-10-27'), { value: '2026-10-27' });
  assert.ok(normalizeAnswer(email, 'not an email').error);
  assert.deepEqual(normalizeAnswer(email, ''), { value: null }, 'optional questions may be left empty');
});

test('checkResponse collects errors per question', () => {
  const form = sampleForm();
  const bad = checkResponse(form, {});
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors), [form.fields[0].id]);
  const good = checkResponse(form, { [form.fields[0].id]: 5 });
  assert.equal(good.ok, true);
  assert.equal(good.values[form.fields[1].id], null);
});

test('responses become a typed dataset, with a yes/no column per checkbox option', () => {
  const form = sampleForm();
  const ids = form.fields.map((q) => q.id);
  const answers = [
    { [ids[0]]: 5, [ids[1]]: 'Lunch', [ids[2]]: ['Coffee', 'Cake'], [ids[3]]: true, [ids[4]]: 12.5, [ids[5]]: '2026-10-01' },
    { [ids[0]]: 3, [ids[1]]: 'Breakfast', [ids[2]]: ['Coffee'], [ids[3]]: false, [ids[4]]: 4 },
    { [ids[0]]: 4 },
  ].map((v) => checkResponse(form, v)).map((c) => newResponse(c.values));
  const ds = responsesToDataset(form, answers);
  assert.equal(ds.rowCount, 3);
  const col = (n) => ds.columns.find((c) => c.name === n);
  assert.equal(col('Overall').type, 'number');
  assert.deepEqual(col('Overall').values, [5, 3, 4]);
  assert.equal(col('Visit').type, 'category');
  assert.equal(col('Return?').type, 'boolean');
  assert.deepEqual(col('Return?').values, [true, false, null]);
  assert.deepEqual(col('Ordered: Coffee').values, [true, true, null]);
  assert.deepEqual(col('Ordered: Sandwich').values, [false, false, null]);
  assert.equal(col('Spent').values[0], 12.5);
  assert.equal(col('When').type, 'date');
  assert.equal(col('Submitted').type, 'date');

  const s = summarizeField(form.fields[0], answers);
  assert.equal(s.answered, 3);
  assert.equal(s.mean, 4);
  assert.deepEqual(s.counts.map((c) => c.count), [0, 0, 1, 1, 1]);
  assert.deepEqual(summarizeField(form.fields[3], answers).counts, [{ label: 'Yes', count: 1 }, { label: 'No', count: 1 }]);
});

test('duplicate question names still give unique columns', () => {
  const form = newForm('x', [newField('text', 'Name'), newField('text', 'Name')]);
  const ds = responsesToDataset(form, []);
  assert.deepEqual(ds.columns.map((c) => c.name), ['Submitted', 'Name', 'Name (2)']);
});

test('share links round-trip, including non-English text', () => {
  const form = sampleForm();
  form.title = 'Encuesta del café ☕ — 日本語';
  const link = shareLink(form, 'https://example.org/lumora/?x=1#old');
  assert.match(link, /^https:\/\/example\.org\/lumora\/\?x=1#form=[A-Za-z0-9_-]+$/);
  const back = decodeForm(link.split('#form=')[1]);
  assert.equal(back.title, form.title);
  assert.equal(back.id, form.id);
  assert.deepEqual(back.fields, form.fields);
  assert.throws(() => decodeForm('%%%'), /damaged/);
});

test('forms from outside are sanitized', () => {
  const evil = sanitizeForm({
    title: 'x'.repeat(5000),
    fields: [
      { id: 'a', type: 'script', label: 'nope' },
      { id: 'a', type: 'choice', label: '<img src=x onerror=alert(1)>', options: [] },
      { id: 'a', type: 'rating', scale: 1000 },
      ...Array.from({ length: 500 }, () => ({ type: 'text' })),
    ],
  });
  assert.equal(evil.title.length, 300);
  assert.equal(evil.fields.length, 99, 'unknown types dropped, at most 100 kept');
  assert.equal(evil.fields[0].type, 'choice');
  assert.deepEqual(evil.fields[0].options, ['Option 1']);
  assert.equal(evil.fields[1].scale, 5);
  assert.equal(new Set(evil.fields.map((q) => q.id)).size, evil.fields.length, 'ids made unique');
  assert.throws(() => sanitizeForm({ title: 'no fields' }), /isn’t a Lumora form/);
});

test('response codes: pasted in bulk, re-checked, and counted once', () => {
  const form = sampleForm();
  const [rating, choice] = form.fields;
  const r1 = newResponse(checkResponse(form, { [rating.id]: 4, [choice.id]: 'Lunch' }).values);
  const r2 = newResponse(checkResponse(form, { [rating.id]: 2 }).values);
  const other = newForm('other', [newField('text')]);
  const pasted = `Hi! here are mine:\n${encodeResponse(form, r1)}\n\n${encodeResponse(form, r2)} and ${encodeResponse(other, newResponse({}))} LUMORA1.garbage!!`;
  const read = readResponses(form, pasted);
  assert.equal(read.forForm.length, 2);
  assert.equal(read.otherForms, 1);
  assert.equal(read.broken, 1);
  assert.equal(read.forForm[0].values[rating.id], 4);

  // A hand-edited code can't smuggle in an answer that isn't an option.
  const tampered = encodeResponse(form, { ...r1, id: 'r-x', values: { [choice.id]: 'Free cake', [rating.id]: 99 } });
  const t = readResponses(form, tampered).forForm[0];
  assert.equal(t.values[choice.id], null);
  assert.equal(t.values[rating.id], null);

  const merged = mergeResponses([r1], read.forForm);
  assert.equal(merged.added, 1);
  assert.equal(merged.responses.length, 2);

  const file = JSON.stringify(responsesFile(form, [r1, r2]));
  assert.equal(readResponses(form, file).forForm.length, 2);
  assert.equal(readResponses(other, file).otherForms, 2);
});

test('every template builds a valid form', () => {
  for (const t of TEMPLATES) {
    const form = t.build();
    assert.ok(form.fields.length >= 4, t.id);
    assert.deepEqual(sanitizeForm(JSON.parse(JSON.stringify(form))).fields, form.fields, `${t.id} survives sharing`);
    assert.ok(form.fields.some((q) => q.required), t.id);
  }
});
