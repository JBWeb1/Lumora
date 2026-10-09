// Filtering, sorting, grouping, formatting and export.

import { parseBoolean, parseDate, parseNumber } from './infer.js';
import { isNum, mean, median, numbers, std, sum } from './stats.js';

export const FILTER_OPS = {
  number: ['=', '≠', '>', '≥', '<', '≤', 'is missing', 'is not missing'],
  date: ['on', 'before', 'after', 'is missing', 'is not missing'],
  boolean: ['is', 'is missing', 'is not missing'],
  category: ['is', 'is not', 'contains', 'is missing', 'is not missing'],
  text: ['contains', 'does not contain', 'is', 'is missing', 'is not missing'],
};

export const NO_VALUE_OPS = new Set(['is missing', 'is not missing']);

function compileFilter(col, filter) {
  const { op } = filter;
  if (op === 'is missing') return (v) => v == null;
  if (op === 'is not missing') return (v) => v != null;

  if (col.type === 'number') {
    const t = parseNumber(filter.value);
    if (t == null) return null;
    const cmp = { '=': (v) => v === t, '≠': (v) => v !== t, '>': (v) => v > t, '≥': (v) => v >= t, '<': (v) => v < t, '≤': (v) => v <= t }[op];
    return cmp && ((v) => v != null && cmp(v));
  }
  if (col.type === 'date') {
    const t = parseDate(filter.value);
    if (t == null) return null;
    const day = 86400000;
    const start = Math.floor(t / day) * day;
    if (op === 'on') return (v) => v != null && v >= start && v < start + day;
    if (op === 'before') return (v) => v != null && v < start;
    if (op === 'after') return (v) => v != null && v >= start + day;
    return null;
  }
  if (col.type === 'boolean') {
    const t = parseBoolean(filter.value);
    return t == null ? null : (v) => v === t;
  }
  const needle = String(filter.value ?? '').trim().toLowerCase();
  const lower = (v) => String(v).toLowerCase();
  if (op === 'is') return (v) => v != null && lower(v) === needle;
  if (op === 'is not') return (v) => v == null || lower(v) !== needle;
  if (op === 'contains') return (v) => v != null && lower(v).includes(needle);
  if (op === 'does not contain') return (v) => v == null || !lower(v).includes(needle);
  return null;
}

/** Row indices that pass every filter. Incomplete filters (e.g. no value yet) are ignored. */
export function applyFilters(dataset, filters = []) {
  const tests = [];
  for (const f of filters) {
    const col = dataset.columns[f.column];
    const test = col && compileFilter(col, f);
    if (test) tests.push([col.values, test]);
  }
  const out = [];
  for (let i = 0; i < dataset.rowCount; i++) {
    if (tests.every(([values, test]) => test(values[i]))) out.push(i);
  }
  return out;
}

/** Keep only rows where any column contains the search text. */
export function searchRows(dataset, indices, query) {
  const q = query.trim().toLowerCase();
  if (!q) return indices;
  return indices.filter((i) => dataset.columns.some((c) => String(c.raw[i]).toLowerCase().includes(q)));
}

function compareValues(a, b) {
  if (typeof a === 'string' || typeof b === 'string') {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort row indices by a column. Missing values always go last. */
export function sortIndices(dataset, indices, columnIndex, direction = 'asc') {
  const values = dataset.columns[columnIndex].values;
  const sign = direction === 'desc' ? -1 : 1;
  return [...indices].sort((i, j) => {
    const a = values[i];
    const b = values[j];
    if (a == null && b == null) return i - j;
    if (a == null) return 1;
    if (b == null) return -1;
    return sign * compareValues(a, b) || i - j;
  });
}

export const AGGREGATIONS = {
  count: { label: 'Count of rows', needsNumber: false },
  distinct: { label: 'Number of distinct values', needsNumber: false },
  sum: { label: 'Sum', needsNumber: true },
  mean: { label: 'Average (mean)', needsNumber: true },
  median: { label: 'Median', needsNumber: true },
  min: { label: 'Minimum', needsNumber: true },
  max: { label: 'Maximum', needsNumber: true },
  std: { label: 'Standard deviation', needsNumber: true },
};

export function aggregate(values, fn) {
  if (fn === 'count') return values.length;
  if (fn === 'distinct') return new Set(values.filter((v) => v != null)).size;
  // Booleans count as 0/1 so "mean" gives the share of yes.
  const xs = numbers(values.map((v) => (typeof v === 'boolean' ? +v : v)));
  if (!xs.length) return null;
  switch (fn) {
    case 'sum': return sum(xs);
    case 'mean': return mean(xs);
    case 'median': return median(xs);
    case 'min': return Math.min(...xs);
    case 'max': return Math.max(...xs);
    case 'std': return xs.length > 1 ? std(xs) : null;
    default: throw new Error(`Unknown aggregation: ${fn}`);
  }
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Bucket a timestamp into a sortable label: "2024", "2024-03", "2024-W09" or "2024-03-05". */
export function dateBucket(ts, unit = 'month') {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  if (unit === 'year') return String(y);
  if (unit === 'month') return `${y}-${pad2(d.getUTCMonth() + 1)}`;
  if (unit === 'weekday') return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  return `${y}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

const WEEKDAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Key used when grouping by a column's value. */
export function groupKey(col, v, dateUnit) {
  if (v == null) return '(missing)';
  if (col.type === 'date') return dateBucket(v, dateUnit);
  if (col.type === 'boolean') return v ? 'yes' : 'no';
  return v;
}

/**
 * Group rows and summarise them, like a pivot table.
 * Returns { headers, types, rows } where rows are arrays of plain values.
 */
export function groupBy(dataset, indices, { by, dateUnit = 'month', aggs = [{ fn: 'count' }] }) {
  const col = dataset.columns[by];
  const groups = new Map();
  for (const i of indices) {
    const key = groupKey(col, col.values[i], dateUnit);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const keys = [...groups.keys()];
  if (col.type === 'date' && dateUnit === 'weekday') {
    keys.sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b));
  } else if (col.type === 'date' || col.type === 'number') {
    keys.sort((a, b) => (a === '(missing)') - (b === '(missing)') || compareValues(a, b));
  } else {
    keys.sort((a, b) => groups.get(b).length - groups.get(a).length || compareValues(a, b));
  }

  const headers = [col.name + (col.type === 'date' ? ` (${dateUnit})` : '')];
  const types = [col.type === 'number' ? 'number' : 'category'];
  for (const a of aggs) {
    const target = a.column != null ? dataset.columns[a.column] : null;
    headers.push(a.fn === 'count' ? 'Rows' : `${AGGREGATIONS[a.fn].label} of ${target.name}`);
    types.push('number');
  }
  const rows = keys.map((key) => {
    const members = groups.get(key);
    return [
      key,
      ...aggs.map((a) => {
        const values = a.column == null ? members : members.map((i) => dataset.columns[a.column].values[i]);
        return aggregate(values, a.fn);
      }),
    ];
  });
  return { headers, types, rows };
}

const numberFormats = new Map();
function numberFormat(maxDigits) {
  if (!numberFormats.has(maxDigits)) {
    numberFormats.set(maxDigits, new Intl.NumberFormat('en-US', { maximumFractionDigits: maxDigits }));
  }
  return numberFormats.get(maxDigits);
}

export function formatNumber(v) {
  if (!isNum(v)) return '–';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e15 || a < 1e-4)) return v.toExponential(2);
  return numberFormat(a >= 100 ? 1 : a >= 1 ? 2 : 4).format(v);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(ts, withTime) {
  const d = new Date(ts);
  const date = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  if (!withTime || ts % 86400000 === 0) return date;
  return `${date} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function formatValue(v, type) {
  if (v == null) return '';
  if (type === 'number') return formatNumber(v);
  if (type === 'date') return formatDate(v, true);
  if (type === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(headers, rows) {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** Export the given rows of a dataset exactly as they were loaded. */
export function datasetToCSV(dataset, indices) {
  const headers = dataset.columns.map((c) => c.name);
  return toCSV(headers, indices.map((i) => dataset.columns.map((c) => c.raw[i])));
}
