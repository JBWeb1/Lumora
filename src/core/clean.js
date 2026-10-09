// Data preparation steps. Each step is a plain object, so the full list ("recipe")
// can be replayed from the original data. That is what makes undo work.

import { convertValues, inferType, isMissingRaw, TYPES } from './infer.js';
import { applyFilters } from './transform.js';
import { evaluateFormula } from './formula.js';
import { frequencies, mean, median, numbers } from './stats.js';

export class StepError extends Error {}

function indexOf(ds, name) {
  const i = ds.columns.findIndex((c) => c.name === name);
  if (i < 0) throw new StepError(`Column "${name}" no longer exists.`);
  return i;
}

function makeColumn(name, raw, type, inferredType) {
  const detected = inferredType ?? inferType(raw);
  const t = type ?? detected;
  return { name, type: t, inferredType: detected, raw, values: convertValues(raw, t) };
}

function withColumn(ds, i, column) {
  const columns = ds.columns.slice();
  columns[i] = column;
  return { ...ds, columns };
}

/** Keep only the given rows (in order). */
export function subsetRows(ds, keep) {
  return {
    ...ds,
    rowCount: keep.length,
    columns: ds.columns.map((c) => ({ ...c, raw: keep.map((i) => c.raw[i]), values: keep.map((i) => c.values[i]) })),
  };
}

/** Indices of rows that exactly repeat an earlier row. */
export function duplicateRows(ds) {
  const seen = new Set();
  const dups = [];
  for (let i = 0; i < ds.rowCount; i++) {
    const key = ds.columns.map((c) => c.raw[i]).join('\u0001');
    if (seen.has(key)) dups.push(i);
    else seen.add(key);
  }
  return dups;
}

/** Compact text for numbers produced by calculations (avoids 0.30000000000000004). */
export function numberToRaw(v) {
  return String(Number(v.toPrecision(12)));
}

function toRaw(v, type) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return type === 'date' ? new Date(v).toISOString().slice(0, 10) : numberToRaw(v);
  return String(v);
}

function fillValue(col, method, value) {
  const present = col.values.filter((v) => v != null);
  if (!present.length) throw new StepError(`${col.name} has no values to learn a fill value from.`);
  if (method === 'mean' || method === 'median') {
    if (col.type !== 'number') throw new StepError(`Filling with the ${method} only works for number columns.`);
    return numberToRaw((method === 'mean' ? mean : median)(numbers(present)));
  }
  if (method === 'mode') return toRaw(frequencies(present)[0].value, col.type);
  if (method === 'value') {
    if (value == null || String(value).trim() === '') throw new StepError('Type the value to fill in.');
    const [parsed] = convertValues([value], col.type);
    if (parsed == null) throw new StepError(`"${value}" isn't a valid ${col.type} for ${col.name}.`);
    return String(value).trim();
  }
  throw new StepError(`Unknown fill method ${method}`);
}

const TEXT_TRANSFORMS = {
  trim: (s) => s.trim().replace(/\s+/g, ' '),
  lower: (s) => s.toLowerCase(),
  upper: (s) => s.toUpperCase(),
  title: (s) => s.toLowerCase().replace(/(^|[\s\-_/])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase()),
};

/** Apply one step and return a new dataset. The input is never modified. */
export function applyStep(ds, step) {
  switch (step.op) {
    case 'removeDuplicates': {
      const dups = new Set(duplicateRows(ds));
      return subsetRows(ds, [...Array(ds.rowCount).keys()].filter((i) => !dups.has(i)));
    }
    case 'dropMissing': {
      const cols = step.column == null ? ds.columns : [ds.columns[indexOf(ds, step.column)]];
      const keep = [];
      for (let i = 0; i < ds.rowCount; i++) if (cols.every((c) => c.values[i] != null)) keep.push(i);
      return subsetRows(ds, keep);
    }
    case 'fillMissing': {
      const i = indexOf(ds, step.column);
      const col = ds.columns[i];
      let raw;
      if (step.method === 'previous') {
        let last = '';
        raw = col.raw.map((r, k) => (col.values[k] == null ? last : (last = r)));
      } else {
        const fill = fillValue(col, step.method, step.value);
        raw = col.raw.map((r, k) => (col.values[k] == null ? fill : r));
      }
      return withColumn(ds, i, makeColumn(col.name, raw, col.type, col.inferredType));
    }
    case 'rename': {
      const i = indexOf(ds, step.column);
      const to = String(step.to ?? '').trim();
      if (!to) throw new StepError('Type a new name.');
      if (to !== step.column && ds.columns.some((c) => c.name === to)) throw new StepError(`There is already a column called "${to}".`);
      return withColumn(ds, i, { ...ds.columns[i], name: to });
    }
    case 'delete': {
      const i = indexOf(ds, step.column);
      if (ds.columns.length === 1) throw new StepError("You can't delete the only column.");
      return { ...ds, columns: ds.columns.filter((_, k) => k !== i) };
    }
    case 'setType': {
      if (!TYPES.includes(step.type)) throw new StepError(`Unknown type ${step.type}`);
      const i = indexOf(ds, step.column);
      const col = ds.columns[i];
      return withColumn(ds, i, { ...col, type: step.type, values: convertValues(col.raw, step.type) });
    }
    case 'text': {
      const i = indexOf(ds, step.column);
      const col = ds.columns[i];
      const fn = TEXT_TRANSFORMS[step.transform];
      if (!fn) throw new StepError(`Unknown text transform ${step.transform}`);
      const raw = col.raw.map((r) => (isMissingRaw(r) ? r : fn(String(r))));
      return withColumn(ds, i, makeColumn(col.name, raw, col.type, col.inferredType));
    }
    case 'formula': {
      const name = String(step.name ?? '').trim();
      if (!name) throw new StepError('Give the new column a name.');
      if (ds.columns.some((c) => c.name === name)) throw new StepError(`There is already a column called "${name}".`);
      const results = evaluateFormula(step.formula, ds);
      const present = results.filter((v) => v != null);
      let type = null;
      if (present.length && present.every((v) => typeof v === 'number')) type = 'number';
      else if (present.length && present.every((v) => typeof v === 'boolean')) type = 'boolean';
      const raw = results.map((v) => toRaw(v, type));
      return { ...ds, columns: [...ds.columns, makeColumn(name, raw, type)] };
    }
    case 'keepRows': {
      const filters = step.filters.map((f) => ({ ...f, column: indexOf(ds, f.column) }));
      return subsetRows(ds, applyFilters(ds, filters));
    }
    default:
      throw new StepError(`Unknown step ${step.op}`);
  }
}

/** Replay a list of steps on the original data. */
export function runRecipe(original, steps) {
  return steps.reduce(applyStep, original);
}

const FILL_LABELS = { mean: 'the average', median: 'the median', mode: 'the most common value', previous: 'the previous row' };
const TEXT_LABELS = { trim: 'Tidy spaces in', lower: 'Lowercase', upper: 'Uppercase', title: 'Title Case' };

/** Human-readable description for the step history. */
export function describeStep(step) {
  switch (step.op) {
    case 'removeDuplicates': return 'Remove duplicate rows';
    case 'dropMissing': return step.column == null ? 'Remove rows with any missing value' : `Remove rows where ${step.column} is missing`;
    case 'fillMissing': return `Fill missing ${step.column} with ${step.method === 'value' ? `"${step.value}"` : FILL_LABELS[step.method]}`;
    case 'rename': return `Rename ${step.column} → ${step.to}`;
    case 'delete': return `Delete column ${step.column}`;
    case 'setType': return `Treat ${step.column} as ${step.type}`;
    case 'text': return `${TEXT_LABELS[step.transform]} ${step.column}`;
    case 'formula': return `New column ${step.name} = ${step.formula}`;
    case 'keepRows': return `Keep only rows where ${step.filters.map((f) => `${f.column} ${f.op}${f.value != null && f.value !== '' ? ` ${f.value}` : ''}`).join(' and ')}`;
    default: return step.op;
  }
}

