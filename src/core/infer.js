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

const COMMA_RE = /^[-+]?(?:[$€£¥]\s?)?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?\s?(?:[$€£¥]|%)?$/;

/**
 * Parse "1,234.5", "$20", "45%", "1e3", "(1,234)" (accounting negative) etc. Returns null when
 * the text is not a number. With `decimalComma`, reads European style: "1.234,5" and "12,50 €".
 */
export function parseNumber(raw, decimalComma = false) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (decimalComma) {
    let sign = 1;
    const paren = /^\((.+)\)$/.exec(s);
    if (paren) {
      s = paren[1].trim();
      sign = -1;
    }
    if (!/\d/.test(s) || !COMMA_RE.test(s)) return null;
    const v = Number(s.replace(/[$€£¥%\s]/g, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(v) ? sign * v : null;
  }
  let sign = 1;
  const paren = /^\((.+)\)$/.exec(s);
  if (paren) {
    s = paren[1].trim();
    sign = -1;
    if (/^[-+]/.test(s)) return null;
  }
  if (!s || !/\d/.test(s) || !NUMBER_RE.test(s)) return null;
  const v = Number(s.replace(/[$€£¥,%\s]/g, ''));
  return Number.isFinite(v) ? sign * v : null;
}

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const ISO_DATETIME = /^\d{4}-\d{1,2}-\d{1,2}[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const YMD_SLASH = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const DMY_OR_MDY = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;
const MONTH_DAY_YEAR = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/;
const DAY_MONTH_YEAR = /^(\d{1,2}) ([A-Za-z]{3,9})\.?,? (\d{4})$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthNumber = (name) => {
  const k = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  // Only real month names ("Sept" and "September" yes, "Janxyz" no).
  return k >= 0 && /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)$/i.test(name) ? k + 1 : null;
};

function utc(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, m - 1, d);
  // Reject roll-overs such as 2023-02-31.
  return new Date(t).getUTCDate() === d ? t : null;
}

/**
 * Parse common date formats into UTC milliseconds. Returns null when not a date.
 * `dayFirst` decides 01/02/2024: true → 1 February, false → 2 January, null → per value
 * (month first unless the first number can't be a month). Whole columns decide it once,
 * in convertValues, so every row of a column is read the same way.
 * Everything is UTC (including date-times without a time zone), so results don't depend
 * on the computer's time zone.
 */
export function parseDate(raw, dayFirst = null) {
  if (raw == null) return null;
  const s = String(raw).trim();
  let m;
  if ((m = ISO_DATE.exec(s)) || (m = YMD_SLASH.exec(s))) return utc(+m[1], +m[2], +m[3]);
  if ((m = DMY_OR_MDY.exec(s))) {
    const a = +m[1];
    const b = +m[2];
    const first = dayFirst ?? a > 12;
    return first ? utc(+m[3], b, a) : utc(+m[3], a, b);
  }
  if ((m = MONTH_DAY_YEAR.exec(s))) {
    const month = monthNumber(m[1]);
    return month ? utc(+m[3], month, +m[2]) : null;
  }
  if ((m = DAY_MONTH_YEAR.exec(s))) {
    const month = monthNumber(m[2]);
    return month ? utc(+m[3], month, +m[1]) : null;
  }
  if (ISO_DATETIME.test(s)) {
    const iso = s.replace(' ', 'T');
    const t = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Decide once for a column whether numbers use a decimal comma ("12,50", "1.234,5").
 * True when some values only make sense that way and none only make sense the usual way.
 */
export function detectDecimalComma(raws) {
  let commaOnly = 0;
  let dotOnly = 0;
  let seen = 0;
  for (const r of raws) {
    if (r == null || isMissingRaw(r)) continue;
    const s = String(r).trim();
    if (++seen > 5000) break;
    const usual = parseNumber(s);
    const comma = parseNumber(s, true);
    if (comma != null && (usual == null || usual !== comma) && /,\d{1,2}(?:\D*)$|\.\d{3},|^\d+,\d{4,}/.test(s)) commaOnly++;
    else if (usual != null && comma == null) dotOnly++;
  }
  return commaOnly > 0 && dotOnly === 0;
}

/**
 * Decide once for a column whether 01/02/2024-style dates are day-first. Day-first when any
 * value's first number is over 12 (31/12/2023), or when they use dots (European style),
 * unless some value's second number is over 12 (then it must be month-first).
 */
export function detectDayFirst(raws) {
  let dayFirst = false;
  let monthFirst = false;
  let dots = 0;
  let seen = 0;
  for (const r of raws) {
    if (r == null) continue;
    const m = DMY_OR_MDY.exec(String(r).trim());
    if (!m) continue;
    seen++;
    if (+m[1] > 12) dayFirst = true;
    if (+m[2] > 12) monthFirst = true;
    if (String(r).includes('.')) dots++;
  }
  if (!seen || (dayFirst && monthFirst)) return null;
  if (dayFirst) return true;
  if (monthFirst) return false;
  return dots > seen / 2 ? true : null;
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
  // Codes such as ZIP codes ("01234") or long IDs aren't quantities: as numbers they would
  // lose leading zeros or digits, so they stay as labels.
  const codeLike = sample.reduce((n, s) => n + (/^[-+]?0\d/.test(s) || /^\d{16,}$/.test(s) ? 1 : 0), 0);
  const comma = detectDecimalComma(sample);
  if (share((s) => parseNumber(s, comma)) >= 0.95 && codeLike / sample.length < 0.05) return 'number';
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
  if (type === 'date') {
    const dayFirst = detectDayFirst(raws);
    return raws.map((r) => (isMissingRaw(r) ? null : parseDate(r, dayFirst)));
  }
  if (type === 'number') {
    const comma = detectDecimalComma(raws);
    return raws.map((r) => (isMissingRaw(r) ? null : parseNumber(r, comma)));
  }
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

/**
 * If a file clearly uses decimal commas (some column has values like "12,50"), numbers such as
 * "1.100" in its other columns are thousands too (1100, not 1.1). Re-read those columns.
 */
function applyFileDecimalComma(columns) {
  if (!columns.some((c) => c.type === 'number' && detectDecimalComma(c.raw))) return;
  for (const c of columns) {
    if (c.type !== 'number' || detectDecimalComma(c.raw)) continue;
    const dotted = c.raw.filter((r) => r != null && /\./.test(r) && !isMissingRaw(r));
    if (dotted.length && dotted.every((r) => /^[-+(]?\s*[$€£¥]?\s?[1-9]\d{0,2}(\.\d{3})+\)?\s?[$€£¥%]?$/.test(String(r).trim()))) {
      c.values = c.raw.map((r) => (isMissingRaw(r) ? null : parseNumber(r, true)));
    }
  }
}

/** Build a column-oriented dataset from a header row and string rows. */
export function buildDataset(name, headers, rows, onProgress) {
  let width = headers.length;
  for (const r of rows) if (r.length > width) width = r.length;
  const names = uniqueNames(headers, width);
  const columns = names.map((colName, j) => {
    const raw = rows.map((r) => r[j] ?? '');
    const type = inferType(raw);
    const column = { name: colName, type, inferredType: type, raw, values: convertValues(raw, type) };
    onProgress?.((j + 1) / width);
    return column;
  });
  applyFileDecimalComma(columns);
  return { name, rowCount: rows.length, columns };
}

/** Re-interpret a column as a different type (e.g. treat a numeric code as a category). */
export function setColumnType(dataset, columnIndex, type) {
  const col = dataset.columns[columnIndex];
  col.type = type;
  col.values = convertValues(col.raw, type);
  return col;
}

/**
 * Load a dataset from file text. Supports CSV, TSV, TXT and JSON.
 * `onProgress(stage, fraction)` reports 'parsing' then 'columns' (used by the background loader).
 */
export function datasetFromText(text, fileName = 'data.csv', onProgress) {
  const name = fileName.replace(/\.[^.]+$/, '') || 'data';
  const trimmed = text.trimStart();
  const columnsProgress = onProgress && ((f) => onProgress('columns', f));
  if (/\.json$/i.test(fileName) || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const { headers, rows } = rowsFromJSON(JSON.parse(text));
    return buildDataset(name, headers, rows, columnsProgress);
  }
  const all = parseCSV(text, /\.tsv$/i.test(fileName) ? '\t' : undefined, onProgress && ((f) => onProgress('parsing', f)));
  if (!all.length) throw new Error('The file is empty.');
  const header = all[0];
  all[0] = null; // let the header row be collected; avoids copying millions of rows with slice(1)
  return buildDataset(name, header, all.slice(1), columnsProgress);
}
