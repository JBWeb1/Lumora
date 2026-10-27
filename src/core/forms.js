// Form maker: design a form, collect answers, and turn them into a dataset to analyse.
//
// Everything is plain data, so forms can be saved, shared as a link and replayed in tests.
// There is no server: a shared form travels inside the link itself (#form=…), and each
// person who fills it in gets a short response code (or file) to send back, which the
// form's owner imports. Nothing is uploaded anywhere.

import { convertValues, inferType, parseDate, parseNumber } from './infer.js';

export const FORM_KIND = 'lumora-form';
export const RESPONSES_KIND = 'lumora-responses';
const CODE_PREFIX = 'LUMORA1.';

export const FIELD_TYPES = {
  text: { label: 'Short answer', icon: 'Aa', column: 'text' },
  paragraph: { label: 'Long answer', icon: '¶', column: 'text' },
  number: { label: 'Number', icon: '#', column: 'number' },
  choice: { label: 'One choice', icon: '◉', column: 'category' },
  checkboxes: { label: 'Several choices', icon: '☑', column: 'text' },
  yesno: { label: 'Yes / No', icon: '✓', column: 'boolean' },
  rating: { label: 'Rating', icon: '★', column: 'number' },
  date: { label: 'Date', icon: '◷', column: 'date' },
  email: { label: 'Email', icon: '@', column: 'text' },
};

const LIMITS = { fields: 100, options: 50, text: 2000, label: 300 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmail = (s) => EMAIL_RE.test(String(s ?? '').trim());

export const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function newField(type = 'text', label = '') {
  const field = { id: newId('q'), type, label: label || FIELD_TYPES[type].label, required: false, help: '' };
  if (type === 'choice' || type === 'checkboxes') field.options = ['Option 1', 'Option 2', 'Option 3'];
  if (type === 'rating') field.scale = 5;
  return field;
}

export function newForm(title = 'Untitled form', fields = []) {
  const now = new Date().toISOString();
  return { kind: FORM_KIND, version: 1, id: newId('f'), title, description: '', replyTo: '', fields, created: now, updated: now };
}

// ---------- templates ----------

const f = (type, label, extra = {}) => ({ ...newField(type, label), ...extra });

export const TEMPLATES = [
  {
    id: 'feedback', emoji: '💬', name: 'Customer feedback',
    description: 'How happy are customers, and why?',
    build: () => newForm('Customer feedback', [
      f('rating', 'How satisfied are you overall?', { required: true }),
      f('choice', 'How did you hear about us?', { options: ['Friend or family', 'Social media', 'Search engine', 'Advert', 'Other'] }),
      f('yesno', 'Would you recommend us to a friend?', { required: true }),
      f('paragraph', 'What could we do better?'),
      f('email', 'Email (if you would like a reply)'),
    ]),
  },
  {
    id: 'event', emoji: '🎟', name: 'Event sign-up',
    description: 'Names, ticket types and dietary needs.',
    build: () => newForm('Event sign-up', [
      f('text', 'Full name', { required: true }),
      f('email', 'Email', { required: true }),
      f('choice', 'Ticket', { options: ['Standard', 'Student', 'VIP'], required: true }),
      f('number', 'Number of guests', { min: 0, max: 10 }),
      f('checkboxes', 'Dietary needs', { options: ['Vegetarian', 'Vegan', 'Gluten free', 'Nut allergy'] }),
    ]),
  },
  {
    id: 'inventory', emoji: '📦', name: 'Stock count',
    description: 'Walk the shelves and record what is there.',
    build: () => newForm('Stock count', [
      f('date', 'Count date', { required: true }),
      f('text', 'Item', { required: true }),
      f('choice', 'Location', { options: ['Front of shop', 'Back room', 'Warehouse'] }),
      f('number', 'Quantity on hand', { required: true, min: 0 }),
      f('yesno', 'Needs reordering?'),
    ]),
  },
  {
    id: 'expenses', emoji: '🧾', name: 'Expense log',
    description: 'Track spending by category.',
    build: () => newForm('Expense log', [
      f('date', 'Date', { required: true }),
      f('number', 'Amount', { required: true, min: 0 }),
      f('choice', 'Category', { options: ['Food', 'Travel', 'Supplies', 'Bills', 'Other'], required: true }),
      f('text', 'Paid to'),
      f('yesno', 'Has receipt?'),
    ]),
  },
  {
    id: 'checkin', emoji: '🌱', name: 'Daily check-in',
    description: 'Mood, sleep and habits, one entry a day.',
    build: () => newForm('Daily check-in', [
      f('date', 'Date', { required: true }),
      f('rating', 'Mood today', { required: true }),
      f('number', 'Hours of sleep', { min: 0, max: 24 }),
      f('checkboxes', 'Done today', { options: ['Exercise', 'Read', 'Meditated', 'Cooked at home'] }),
      f('paragraph', 'Notes'),
    ]),
  },
];

// ---------- answers ----------

/** Turn what was typed into a clean value, or { error } when it can't be used. */
export function normalizeAnswer(field, input) {
  const empty = input == null || (Array.isArray(input) ? input.length === 0 : String(input).trim() === '');
  if (empty) return field.required ? { error: 'This question needs an answer.' } : { value: null };
  switch (field.type) {
    case 'number': {
      const n = parseNumber(String(input));
      if (n == null) return { error: 'Enter a number.' };
      if (field.min != null && field.min !== '' && n < Number(field.min)) return { error: `Must be at least ${field.min}.` };
      if (field.max != null && field.max !== '' && n > Number(field.max)) return { error: `Must be at most ${field.max}.` };
      return { value: n };
    }
    case 'rating': {
      const n = Number(input);
      const scale = field.scale ?? 5;
      if (!Number.isInteger(n) || n < 1 || n > scale) return { error: `Pick 1 to ${scale}.` };
      return { value: n };
    }
    case 'yesno': {
      const v = input === true || input === 'yes' ? true : input === false || input === 'no' ? false : null;
      return v == null ? { error: 'Choose yes or no.' } : { value: v };
    }
    case 'date': {
      const t = parseDate(String(input));
      return t == null ? { error: 'Enter a date.' } : { value: new Date(t).toISOString().slice(0, 10) };
    }
    case 'email': {
      const s = String(input).trim();
      return EMAIL_RE.test(s) ? { value: s } : { error: 'Enter an email address like name@example.com.' };
    }
    case 'choice': {
      const s = String(input);
      return field.options.includes(s) ? { value: s } : { error: 'Pick one of the options.' };
    }
    case 'checkboxes': {
      const picked = [].concat(input).map(String).filter((s) => field.options.includes(s));
      if (!picked.length) return field.required ? { error: 'Pick at least one.' } : { value: null };
      return { value: field.options.filter((o) => picked.includes(o)) };
    }
    default:
      return { value: String(input).trim().slice(0, LIMITS.text) };
  }
}

/** Check a whole submission. Returns { ok, values, errors } with errors keyed by field id. */
export function checkResponse(form, inputs) {
  const values = {};
  const errors = {};
  for (const field of form.fields) {
    const r = normalizeAnswer(field, inputs[field.id]);
    if (r.error) errors[field.id] = r.error;
    else values[field.id] = r.value;
  }
  return { ok: Object.keys(errors).length === 0, values, errors };
}

export function newResponse(values) {
  return { id: newId('r'), submitted: new Date().toISOString(), values };
}

/** Add responses that aren't there yet (the same response imported twice counts once). */
export function mergeResponses(existing, incoming) {
  const seen = new Set(existing.map((r) => r.id));
  const added = incoming.filter((r) => !seen.has(r.id) && (seen.add(r.id), true));
  return { responses: [...existing, ...added], added: added.length };
}

// ---------- responses → dataset ----------

const MAX_OPTION_COLUMNS = 8;

/** One row per response, typed columns. Several-choice questions also get a yes/no column per option. */
export function responsesToDataset(form, responses) {
  const specs = [{ name: 'Submitted', type: 'date', get: (r) => r.submitted.slice(0, 10) }];
  const shortText = new Set();
  for (const field of form.fields) {
    const get = (r) => r.values?.[field.id];
    const type = FIELD_TYPES[field.type]?.column ?? 'text';
    if (field.type === 'checkboxes') {
      specs.push({ name: field.label, type: 'text', get: (r) => (get(r) ?? []).join('; ') });
      if (field.options.length <= MAX_OPTION_COLUMNS) {
        for (const opt of field.options) specs.push({ name: `${field.label}: ${opt}`, type: 'boolean', get: (r) => (get(r) == null ? '' : get(r).includes(opt) ? 'yes' : 'no') });
      }
    } else if (field.type === 'yesno') {
      specs.push({ name: field.label, type, get: (r) => (get(r) == null ? '' : get(r) ? 'yes' : 'no') });
    } else {
      const spec = { name: field.label, type, get: (r) => (get(r) == null ? '' : String(get(r))) };
      if (field.type === 'text') shortText.add(spec);
      specs.push(spec);
    }
  }
  const used = new Set();
  const columns = specs.map((s) => {
    let name = s.name.trim() || 'Question';
    for (let k = 2; used.has(name); k++) name = `${s.name} (${k})`;
    used.add(name);
    const raw = responses.map(s.get);
    // Free text that turns out to be categories (e.g. short repeated answers) is easier to chart as one.
    const type = shortText.has(s) && inferType(raw) === 'category' ? 'category' : s.type;
    return { name, type, inferredType: type, raw, values: convertValues(raw, type) };
  });
  return { name: form.title || 'Form responses', rowCount: responses.length, columns };
}

/** A quick per-question summary for the Responses page. */
export function summarizeField(field, responses) {
  const answers = responses.map((r) => r.values?.[field.id]).filter((v) => v != null && !(Array.isArray(v) && !v.length));
  const out = { answered: answers.length, total: responses.length };
  if (field.type === 'number' || field.type === 'rating') {
    const xs = answers.map(Number);
    out.mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    out.min = xs.length ? Math.min(...xs.slice(0, 100000)) : null;
    out.max = xs.length ? Math.max(...xs.slice(0, 100000)) : null;
  }
  if (field.type === 'choice' || field.type === 'checkboxes' || field.type === 'yesno' || field.type === 'rating') {
    const keys = field.type === 'yesno' ? [true, false]
      : field.type === 'rating' ? Array.from({ length: field.scale ?? 5 }, (_, k) => k + 1)
        : field.options;
    const counts = new Map(keys.map((k) => [k, 0]));
    for (const a of answers) for (const v of [].concat(a)) if (counts.has(v)) counts.set(v, counts.get(v) + 1);
    out.counts = keys.map((k) => ({ label: k === true ? 'Yes' : k === false ? 'No' : String(k), count: counts.get(k) }));
  }
  if (['text', 'paragraph', 'email', 'date'].includes(field.type)) out.latest = answers.slice(-3).reverse().map(String);
  return out;
}

// ---------- sharing: links and response codes ----------

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const clip = (v, max) => String(v ?? '').slice(0, max);

/**
 * Accept a form from outside (a link or a file) only in the expected shape, with sane sizes.
 * Throws a readable error otherwise.
 */
export function sanitizeForm(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.fields)) throw new Error('This isn’t a Lumora form.');
  const fields = raw.fields.slice(0, LIMITS.fields).filter((q) => q && FIELD_TYPES[q.type]).map((q) => {
    const field = { id: clip(q.id, 40) || newId('q'), type: q.type, label: clip(q.label, LIMITS.label) || FIELD_TYPES[q.type].label, required: q.required === true, help: clip(q.help, LIMITS.label) };
    if (q.type === 'choice' || q.type === 'checkboxes') {
      field.options = [...new Set((Array.isArray(q.options) ? q.options : []).slice(0, LIMITS.options).map((o) => clip(o, LIMITS.label)).filter(Boolean))];
      if (!field.options.length) field.options = ['Option 1'];
    }
    if (q.type === 'rating') field.scale = [3, 5, 7, 10].includes(Number(q.scale)) ? Number(q.scale) : 5;
    if (q.type === 'number') {
      if (Number.isFinite(Number(q.min)) && q.min !== '' && q.min != null) field.min = Number(q.min);
      if (Number.isFinite(Number(q.max)) && q.max !== '' && q.max != null) field.max = Number(q.max);
    }
    return field;
  });
  const ids = new Set();
  for (const q of fields) {
    while (ids.has(q.id)) q.id = newId('q');
    ids.add(q.id);
  }
  const replyTo = EMAIL_RE.test(String(raw.replyTo ?? '').trim()) ? clip(String(raw.replyTo).trim(), 200) : '';
  return { kind: FORM_KIND, version: 1, id: clip(raw.id, 40) || newId('f'), title: clip(raw.title, LIMITS.label) || 'Untitled form', description: clip(raw.description, LIMITS.text), replyTo, fields, created: clip(raw.created, 40), updated: clip(raw.updated, 40) };
}

/** The part of the link after #form= */
export function encodeForm(form) {
  const { id, title, description, replyTo, fields } = form;
  return toBase64Url(JSON.stringify({ id, title, description, replyTo, fields }));
}

export function decodeForm(code) {
  let json;
  try {
    json = JSON.parse(fromBase64Url(code));
  } catch {
    throw new Error('This form link is incomplete or damaged. Ask for the link again.');
  }
  return sanitizeForm(json);
}

export function shareLink(form, base) {
  return `${base.split('#')[0]}#form=${encodeForm(form)}`;
}

/** A short code the person who filled in the form sends back to its owner. */
export function encodeResponse(form, response) {
  return CODE_PREFIX + toBase64Url(JSON.stringify({ f: form.id, i: response.id, t: response.submitted, v: response.values }));
}

/**
 * Find responses in pasted text (any number of codes) or in a responses file.
 * Returns { forForm: [...responses for this form], otherForms: count, broken: count }.
 */
export function readResponses(form, text) {
  const found = [];
  let broken = 0;
  let otherForms = 0;
  const trimmed = String(text).trim();
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed);
      if (json.kind === RESPONSES_KIND && Array.isArray(json.responses)) {
        if (json.formId !== form.id) return { forForm: [], otherForms: json.responses.length, broken: 0 };
        for (const r of json.responses) found.push(r);
      }
    } catch {
      broken++;
    }
  }
  for (const m of trimmed.matchAll(/LUMORA1\.([A-Za-z0-9_-]+)/g)) {
    try {
      const r = JSON.parse(fromBase64Url(m[1]));
      if (r.f !== form.id) {
        otherForms++;
        continue;
      }
      found.push({ id: r.i, submitted: r.t, values: r.v });
    } catch {
      broken++;
    }
  }
  // Re-check every answer against the form, so a hand-edited code can't sneak in bad data.
  const forForm = [];
  for (const r of found) {
    if (!r || typeof r.id !== 'string' || typeof r.values !== 'object' || r.values == null) {
      broken++;
      continue;
    }
    const values = {};
    for (const field of form.fields) {
      const v = r.values[field.id];
      const checked = normalizeAnswer({ ...field, required: false }, field.type === 'yesno' && typeof v === 'boolean' ? (v ? 'yes' : 'no') : v);
      values[field.id] = checked.error ? null : checked.value;
    }
    const submitted = Number.isFinite(Date.parse(r.submitted)) ? new Date(r.submitted).toISOString() : new Date().toISOString();
    forForm.push({ id: clip(r.id, 40), submitted, values });
  }
  return { forForm, otherForms, broken };
}

export function responsesFile(form, responses) {
  return { kind: RESPONSES_KIND, version: 1, formId: form.id, formTitle: form.title, responses };
}
