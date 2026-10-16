// Data preparation steps. Each step is a plain object, so the full list ("recipe")
// can be replayed from the original data. That is what makes undo work.

import { convertValues, inferType, isMissingRaw, TYPES } from './infer.js';
import { applyFilters } from './transform.js';
import { evaluateFormula } from './formula.js';
import { appendRows, joinColumns } from './combine.js';
import { extent, frequencies, mean, median, numbers } from './stats.js';

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

/** Indices of rows that repeat an earlier row (in every column, or only in the given ones). */
export function duplicateRows(ds, columnNames = null) {
  const keyCols = columnNames?.length ? columnNames.map((n) => ds.columns[indexOf(ds, n)]) : ds.columns;
  const seen = new Set();
  const dups = [];
  for (let i = 0; i < ds.rowCount; i++) {
    const key = keyCols.map((c) => (columnNames?.length ? String(c.raw[i] ?? '').trim().toLowerCase() : c.raw[i])).join('\u0001');
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

/** A column name that isn't taken yet: "Price", "Price (2)", … */
export function uniqueName(ds, base) {
  const taken = new Set(ds.columns.map((c) => c.name));
  if (!taken.has(base)) return base;
  let k = 2;
  while (taken.has(`${base} (${k})`)) k++;
  return `${base} (${k})`;
}

function newColumnName(ds, name) {
  const n = String(name ?? '').trim();
  if (!n) throw new StepError('Give the new column a name.');
  if (ds.columns.some((c) => c.name === n)) throw new StepError(`There is already a column called "${n}".`);
  return n;
}

const MAX_SPLIT_PARTS = 10;

/** How many pieces splitting a column by `by` gives (at most MAX_SPLIT_PARTS). */
export function splitCount(col, by) {
  if (!by) return 0;
  let most = 0;
  for (const r of col.raw) {
    if (isMissingRaw(r)) continue;
    most = Math.max(most, String(r).split(by).length);
    if (most >= MAX_SPLIT_PARTS) return MAX_SPLIT_PARTS;
  }
  return most;
}

/** Round a bin width to 1, 2, 2.5 or 5 × a power of ten, so ranges read naturally. */
export function niceBinSize(min, max, target = 6) {
  const span = max - min;
  if (!(span > 0)) return 1;
  const rough = span / target;
  const p = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= rough) ?? 10 * p;
}

const fmt = (x) => String(Number(x.toPrecision(12)));

/** Label of the range a number falls into, e.g. "20 – 30". */
export function binLabel(v, size, start) {
  const k = Math.floor((v - start) / size + 1e-9);
  const lo = start + k * size;
  return `${fmt(lo)} – ${fmt(lo + size)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DATE_PARTS = {
  year: { label: 'Year', type: 'number', fn: (d) => String(d.getUTCFullYear()) },
  quarter: { label: 'Quarter', type: 'category', fn: (d) => `Q${Math.floor(d.getUTCMonth() / 3) + 1}` },
  month: { label: 'Month', type: 'category', fn: (d) => MONTHS[d.getUTCMonth()] },
  yearMonth: { label: 'Year and month', type: 'category', fn: (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` },
  weekday: { label: 'Day of the week', type: 'category', fn: (d) => DAYS[d.getUTCDay()] },
  day: { label: 'Day of the month', type: 'number', fn: (d) => String(d.getUTCDate()) },
};

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
      const dups = new Set(duplicateRows(ds, step.columns));
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
    case 'replace': {
      const i = indexOf(ds, step.column);
      const col = ds.columns[i];
      const find = String(step.find ?? '');
      if (!find.trim() && step.match !== 'exact') throw new StepError('Type the text to find.');
      const to = String(step.replace ?? '');
      const fold = (x) => (step.matchCase ? x : x.toLowerCase());
      let raw;
      if (step.match === 'contains') {
        const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), step.matchCase ? 'g' : 'gi');
        raw = col.raw.map((r) => (r == null ? r : String(r).replace(pattern, () => to)));
      } else {
        const target = fold(find.trim());
        raw = col.raw.map((r) => (fold(String(r ?? '').trim()) === target ? to : r));
      }
      return withColumn(ds, i, makeColumn(col.name, raw, col.type, col.inferredType));
    }
    case 'standardize': {
      const i = indexOf(ds, step.column);
      const col = ds.columns[i];
      const map = step.map ?? {};
      const raw = col.raw.map((r) => (r != null && Object.hasOwn(map, String(r)) ? map[String(r)] : r));
      return withColumn(ds, i, makeColumn(col.name, raw, col.type, col.inferredType));
    }
    case 'split': {
      const i = indexOf(ds, step.column);
      const col = ds.columns[i];
      const by = String(step.by ?? '');
      if (!by) throw new StepError('Choose what to split on.');
      const parts = splitCount(col, by);
      if (parts < 2) throw new StepError(`No value in ${col.name} contains "${by}", so there is nothing to split.`);
      const pieces = col.raw.map((r) => (isMissingRaw(r) ? [] : String(r).split(by)));
      let out = ds;
      const added = [];
      for (let k = 0; k < parts; k++) {
        // The last piece keeps any remaining separators, so no text is lost.
        const raw = pieces.map((p) => (k === parts - 1 ? p.slice(k).join(by) : p[k] ?? '').trim());
        const column = makeColumn(uniqueName(out, `${col.name} ${k + 1}`), raw);
        out = { ...out, columns: [...out.columns, column] };
        added.push(column);
      }
      // Put the new columns right after the original.
      const rest = ds.columns.slice();
      rest.splice(i + 1, 0, ...added);
      return { ...ds, columns: rest };
    }
    case 'group': {
      const i = indexOf(ds, step.column);
      const col = ds.columns[i];
      const name = newColumnName(ds, step.name);
      let raw;
      if (step.method === 'bins') {
        if (col.type !== 'number') throw new StepError('Ranges only work for number columns.');
        const present = numbers(col.values);
        if (!present.length) throw new StepError(`${col.name} has no numbers to group.`);
        const [lo, hi] = extent(present);
        const size = Number(step.size) > 0 ? Number(step.size) : niceBinSize(lo, hi);
        const start = Math.floor(lo / size) * size;
        raw = col.values.map((v) => (v == null ? '' : binLabel(v, size, start)));
      } else if (step.method === 'top') {
        const keep = Math.max(1, Math.floor(Number(step.keep) || 5));
        const top = new Set(frequencies(col.values.filter((v) => v != null)).slice(0, keep).map((f) => f.value));
        raw = col.values.map((v, k) => (v == null ? '' : top.has(v) ? String(col.raw[k]).trim() : 'Other'));
      } else throw new StepError(`Unknown grouping ${step.method}`);
      const column = makeColumn(name, raw, 'category');
      const columns = ds.columns.slice();
      columns.splice(i + 1, 0, column);
      return { ...ds, columns };
    }
    case 'dateParts': {
      const i = indexOf(ds, step.column);
      const col = ds.columns[i];
      if (col.type !== 'date') throw new StepError(`${col.name} isn't a date column.`);
      const part = DATE_PARTS[step.part];
      if (!part) throw new StepError(`Unknown date part ${step.part}`);
      const name = newColumnName(ds, step.name);
      const raw = col.values.map((v) => (v == null ? '' : part.fn(new Date(v))));
      const columns = ds.columns.slice();
      columns.splice(i + 1, 0, makeColumn(name, raw, part.type));
      return { ...ds, columns };
    }
    case 'append':
      return appendRows(ds, step.data, { sourceColumn: step.sourceColumn ?? null, baseLabel: step.baseLabel ?? ds.name, otherLabel: step.data.name });
    case 'join':
      return joinColumns(ds, step.data, { leftKey: step.leftKey, rightKey: step.rightKey, how: step.how ?? 'left' });
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
    case 'removeDuplicates': return step.columns?.length ? `Remove rows that repeat ${step.columns.join(' + ')}` : 'Remove duplicate rows';
    case 'replace': return `Replace ${step.match === 'contains' ? '' : 'the value '}"${step.find}" with ${step.replace === '' ? 'nothing' : `"${step.replace}"`} in ${step.column}`;
    case 'standardize': {
      const n = Object.keys(step.map ?? {}).length;
      return `Merge ${n} spelling variant${n === 1 ? '' : 's'} in ${step.column}`;
    }
    case 'split': return `Split ${step.column} on "${step.by}"`;
    case 'group': return step.method === 'bins'
      ? `New column ${step.name}: ${step.column} grouped into ranges${step.size ? ` of ${step.size}` : ''}`
      : `New column ${step.name}: top ${step.keep} ${step.column} values, the rest as Other`;
    case 'dateParts': return `New column ${step.name}: ${DATE_PARTS[step.part]?.label.toLowerCase() ?? step.part} of ${step.column}`;
    case 'dropMissing': return step.column == null ? 'Remove rows with any missing value' : `Remove rows where ${step.column} is missing`;
    case 'fillMissing': return `Fill missing ${step.column} with ${step.method === 'value' ? `"${step.value}"` : FILL_LABELS[step.method]}`;
    case 'rename': return `Rename ${step.column} → ${step.to}`;
    case 'delete': return `Delete column ${step.column}`;
    case 'setType': return `Treat ${step.column} as ${step.type}`;
    case 'text': return `${TEXT_LABELS[step.transform]} ${step.column}`;
    case 'formula': return `New column ${step.name} = ${step.formula}`;
    case 'append': return `Add ${step.data.rows.length.toLocaleString('en-US')} rows from ${step.data.name}`;
    case 'join': return `Add columns from ${step.data.name} matched on ${step.leftKey}${step.leftKey === step.rightKey ? '' : ` = ${step.rightKey}`} (${{ left: 'keep all rows', inner: 'only matches', full: 'all rows from both' }[step.how ?? 'left']})`;
    case 'keepRows': return `Keep only rows where ${step.filters.map((f) => `${f.column} ${f.op}${f.value != null && f.value !== '' ? ` ${f.value}` : ''}`).join(' and ')}`;
    default: return step.op;
  }
}

