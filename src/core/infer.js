// Column type inference and value conversion.
//
// Types:
//   number   – numeric measurements (values: number | null)
//   date     – dates / timestamps    (values: UTC milliseconds | null)
//   boolean  – yes/no, true/false    (values: true | false | null)
//   category – a small set of labels (values: string | null)
//   text     – free text / IDs       (values: string | null)

import { parseCSV, rowsFromJSON } from './csv.js';

export const TYPES = ['number', 'date', 'boolean', 'category', 'text'];

const MISSING = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '-', '--', '?', 'missing', 'undefined', '#n/a']);
const TRUE = new Set(['true', 'yes', 'y', 't']);
const FALSE = new Set(['false', 'no', 'n', 'f']);

export function isMissingRaw(raw) {
  return raw == null || MISSING.has(String(raw).trim().toLowerCase());
}

const NUMBER_RE = /^[-+]?(?:[$€£¥]\s?)?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:e[-+]?\d+)?%?$/i;

/** Parse "1,234.5", "$20", "45%", "1e3" etc. Returns null when the text is not a number. */
export function parseNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || !/\d/.test(s) || !NUMBER_RE.test(s)) return null;
  const v = Number(s.replace(/[$€£¥,%\s]/g, ''));
  return Number.isFinite(v) ? v : null;
}

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const ISO_DATETIME = /^\d{4}-\d{1,2}-\d{1,2}[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const YMD_SLASH = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const DMY_OR_MDY = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;
const NAMED_MONTH = /^(?:[A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2} [A-Za-z]{3,9}\.? \d{4})$/;

function utc(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, m - 1, d);
  // Reject roll-overs such as 2023-02-31.
  return new Date(t).getUTCDate() === d ? t : null;
}

/** Parse common date formats into UTC milliseconds. Returns null when not a date. */
export function parseDate(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  let m;
  if ((m = ISO_DATE.exec(s)) || (m = YMD_SLASH.exec(s))) return utc(+m[1], +m[2], +m[3]);
  if ((m = DMY_OR_MDY.exec(s))) {
    const a = +m[1];
    const b = +m[2];
    // Assume month/day/year unless the first number can't be a month.
    return a > 12 ? utc(+m[3], b, a) : utc(+m[3], a, b);
  }
  if (ISO_DATETIME.test(s) || NAMED_MONTH.test(s)) {
    const t = Date.parse(s.replace(' ', 'T'));
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function parseBoolean(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (TRUE.has(s)) return true;
  if (FALSE.has(s)) return false;
  return null;
}

function sampleOf(values, max = 5000) {
  if (values.length <= max) return values;
  const step = values.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(values[Math.floor(i * step)]);
  return out;
}

/** Decide the most useful type for a column of raw strings. */
export function inferType(raws) {
  const present = raws.filter((r) => !isMissingRaw(r)).map((r) => String(r).trim());
  if (!present.length) return 'text';
  const sample = sampleOf(present);
  const share = (parse) => sample.reduce((n, s) => n + (parse(s) != null ? 1 : 0), 0) / sample.length;

  if (share(parseBoolean) === 1) return 'boolean';
  if (share(parseNumber) >= 0.95) return 'number';
  if (share(parseDate) >= 0.95) return 'date';

  const unique = new Set(present).size;
  const avgLength = sample.reduce((n, s) => n + s.length, 0) / sample.length;
  if (avgLength <= 40 && unique <= Math.max(25, present.length * 0.5)) return 'category';
  return 'text';
}

const PARSERS = {
  number: parseNumber,
  date: parseDate,
  boolean: parseBoolean,
  category: (s) => String(s).trim(),
  text: (s) => String(s).trim(),
};

export function convertValues(raws, type) {
  const parse = PARSERS[type];
  return raws.map((r) => (isMissingRaw(r) ? null : parse(r)));
}

function uniqueNames(headers, width) {
  const used = new Set();
  const names = [];
  for (let j = 0; j < width; j++) {
    let base = String(headers[j] ?? '').trim() || `Column ${j + 1}`;
    let name = base;
    for (let k = 2; used.has(name); k++) name = `${base} (${k})`;
    used.add(name);
    names.push(name);
  }
  return names;
}

/** Build a column-oriented dataset from a header row and string rows. */
export function buildDataset(name, headers, rows) {
  let width = headers.length;
  for (const r of rows) if (r.length > width) width = r.length;
  const names = uniqueNames(headers, width);
  const columns = names.map((colName, j) => {
    const raw = rows.map((r) => r[j] ?? '');
    const type = inferType(raw);
    return { name: colName, type, inferredType: type, raw, values: convertValues(raw, type) };
  });
  return { name, rowCount: rows.length, columns };
}

/** Re-interpret a column as a different type (e.g. treat a numeric code as a category). */
export function setColumnType(dataset, columnIndex, type) {
  const col = dataset.columns[columnIndex];
  col.type = type;
  col.values = convertValues(col.raw, type);
  return col;
}

/** Load a dataset from file text. Supports CSV, TSV, TXT and JSON. */
export function datasetFromText(text, fileName = 'data.csv') {
  const name = fileName.replace(/\.[^.]+$/, '') || 'data';
  const trimmed = text.trimStart();
  if (/\.json$/i.test(fileName) || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const { headers, rows } = rowsFromJSON(JSON.parse(text));
    return buildDataset(name, headers, rows);
  }
  const all = parseCSV(text, /\.tsv$/i.test(fileName) ? '\t' : undefined);
  if (!all.length) throw new Error('The file is empty.');
  return buildDataset(name, all[0], all.slice(1));
}
