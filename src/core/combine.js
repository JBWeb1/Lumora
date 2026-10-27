// Combining datasets:
//   appendRows  – stack files with the same columns (January + February + March sales)
//   joinColumns – add columns from another file by matching a shared column (orders + customers)
//
// Both work on the raw text and re-detect column types afterwards, keeping any type the
// user had chosen for an existing column.

import { buildDataset, convertValues, parseNumber } from './infer.js';

const norm = (s) => String(s).trim().toLowerCase();

/** Header row plus raw text rows of a dataset. */
export function rawTable(ds) {
  return {
    name: ds.name,
    headers: ds.columns.map((c) => c.name),
    rows: Array.from({ length: ds.rowCount }, (_, i) => ds.columns.map((c) => c.raw[i])),
  };
}

function uniqueName(name, used) {
  let out = name;
  for (let k = 2; used.has(norm(out)); k++) out = `${name} (${k})`;
  used.add(norm(out));
  return out;
}

/** Rebuild a dataset, keeping user-chosen types of columns that came from `base`. */
function rebuild(base, headers, rows, keepTypesFrom) {
  const ds = buildDataset(base.name, headers, rows);
  for (const col of ds.columns) {
    const old = keepTypesFrom.get(col.name);
    if (old && old.type !== col.type && old.type !== old.inferredType) {
      col.type = old.type;
      col.values = convertValues(col.raw, old.type);
    }
  }
  return ds;
}

/** How the columns of two tables line up when stacking them. */
export function matchColumns(baseHeaders, otherHeaders) {
  const otherByName = new Map(otherHeaders.map((h, j) => [norm(h), j]));
  const matched = baseHeaders.filter((h) => otherByName.has(norm(h)));
  const onlyBase = baseHeaders.filter((h) => !otherByName.has(norm(h)));
  const baseNames = new Set(baseHeaders.map(norm));
  const onlyOther = otherHeaders.filter((h) => !baseNames.has(norm(h)));
  return { matched, onlyBase, onlyOther };
}

/**
 * Stack `other` (a raw table) under `base` (a dataset). Columns are matched by name,
 * ignoring case and spaces; unmatched columns are kept and left blank where missing.
 * With `sourceColumn`, a column records which file each row came from.
 */
export function appendRows(base, other, { sourceColumn = null, baseLabel = base.name, otherLabel = other.name } = {}) {
  const baseTable = rawTable(base);
  const used = new Set(baseTable.headers.map(norm));
  const headers = [...baseTable.headers];
  const otherIndex = new Map();
  other.headers.forEach((h, j) => {
    const at = baseTable.headers.findIndex((b) => norm(b) === norm(h));
    if (at >= 0) otherIndex.set(at, j);
    else {
      headers.push(uniqueName(h, used));
      otherIndex.set(headers.length - 1, j);
    }
  });
  let sourceAt = -1;
  if (sourceColumn) {
    sourceAt = headers.findIndex((h) => norm(h) === norm(sourceColumn));
    if (sourceAt < 0 || otherIndex.has(sourceAt)) {
      // New source column; existing rows get the base label.
      headers.push(uniqueName(sourceColumn, used));
      sourceAt = headers.length - 1;
      baseTable.rows.forEach((r) => { r[sourceAt] = baseLabel; });
    }
  }
  const width = headers.length;
  const rows = baseTable.rows.map((r) => Array.from({ length: width }, (_, k) => r[k] ?? ''));
  for (const r of other.rows) {
    const row = Array.from({ length: width }, (_, k) => (otherIndex.has(k) ? r[otherIndex.get(k)] ?? '' : ''));
    if (sourceAt >= 0) row[sourceAt] = otherLabel;
    rows.push(row);
  }
  return rebuild(base, headers, rows, new Map(base.columns.map((c) => [c.name, c])));
}

/** Join keys ignore case, surrounding spaces and number formatting ("007" = "7", "1,000" = "1000"). */
export function joinKey(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  const n = parseNumber(t);
  // Numbers match regardless of formatting ("007" = "7", "1,000" = "1000"), but IDs longer than
  // 15 digits can't be held exactly as numbers, so they are compared as text.
  const digits = t.replace(/\D/g, '').length;
  return n != null && digits <= 15 ? `#${n}` : t.toLowerCase();
}

function indexByKey(rows, col) {
  const map = new Map();
  rows.forEach((r, i) => {
    const k = joinKey(r[col]);
    if (k == null) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  });
  return map;
}

/** Quick statistics for the join preview, without building anything. */
export function previewJoin(base, other, { leftKey, rightKey, how = 'left' }) {
  const lk = base.columns.findIndex((c) => c.name === leftKey);
  const rk = other.headers.indexOf(rightKey);
  if (lk < 0 || rk < 0) return null;
  const right = indexByKey(other.rows, rk);
  const usedRight = new Set();
  let matchedLeft = 0;
  let resultRows = 0;
  for (let i = 0; i < base.rowCount; i++) {
    const m = right.get(joinKey(base.columns[lk].raw[i]));
    if (m) {
      matchedLeft++;
      resultRows += m.length;
      m.forEach((j) => usedRight.add(j));
    } else if (how !== 'inner') resultRows++;
  }
  const unmatchedRight = other.rows.length - usedRight.size;
  if (how === 'full') resultRows += unmatchedRight;
  const duplicateKeys = [...right.values()].filter((v) => v.length > 1).length;
  return { leftRows: base.rowCount, rightRows: other.rows.length, matchedLeft, unmatchedLeft: base.rowCount - matchedLeft, unmatchedRight, duplicateKeys, resultRows };
}

/**
 * Add the columns of `other` (a raw table) to `base` by matching leftKey = rightKey.
 *   how: 'left'  keep every row of base (blank where there is no match)
 *        'inner' keep only rows that match
 *        'full'  keep every row of both
 */
export function joinColumns(base, other, { leftKey, rightKey, how = 'left' }) {
  const lk = base.columns.findIndex((c) => c.name === leftKey);
  const rk = other.headers.indexOf(rightKey);
  if (lk < 0) throw new Error(`Column "${leftKey}" no longer exists.`);
  if (rk < 0) throw new Error(`The other file has no column "${rightKey}".`);
  const baseTable = rawTable(base);
  const used = new Set(baseTable.headers.map(norm));
  const rightCols = other.headers.map((h, j) => j).filter((j) => j !== rk);
  // Columns that clash with an existing name get the other file's name added: "city (customers)".
  const headers = [...baseTable.headers, ...rightCols.map((j) => {
    const h = other.headers[j];
    return uniqueName(used.has(norm(h)) ? `${h} (${other.name})` : h, used);
  })];
  const right = indexByKey(other.rows, rk);
  const blanks = rightCols.map(() => '');
  const rows = [];
  const usedRight = new Set();
  baseTable.rows.forEach((r) => {
    const matches = right.get(joinKey(r[lk]));
    if (matches) {
      for (const j of matches) {
        usedRight.add(j);
        rows.push([...r, ...rightCols.map((c) => other.rows[j][c] ?? '')]);
      }
    } else if (how !== 'inner') rows.push([...r, ...blanks]);
  });
  if (how === 'full') {
    other.rows.forEach((r, j) => {
      if (usedRight.has(j)) return;
      const left = baseTable.headers.map((_, k) => (k === lk ? r[rk] ?? '' : ''));
      rows.push([...left, ...rightCols.map((c) => r[c] ?? '')]);
    });
  }
  return rebuild(base, headers, rows, new Map(base.columns.map((c) => [c.name, c])));
}

/** Suggest the best pair of key columns: same name first, then the pair whose values overlap most. */
export function suggestJoinKeys(base, other) {
  let best = null;
  for (const col of base.columns) {
    const leftKeys = new Set();
    for (let i = 0; i < Math.min(base.rowCount, 5000); i++) {
      const k = joinKey(col.raw[i]);
      if (k != null) leftKeys.add(k);
    }
    if (leftKeys.size < 2) continue;
    other.headers.forEach((h, rk) => {
      let hits = 0;
      const rightKeys = new Set();
      for (const r of other.rows.slice(0, 5000)) {
        const k = joinKey(r[rk]);
        if (k == null || rightKeys.has(k)) continue;
        rightKeys.add(k);
        if (leftKeys.has(k)) hits++;
      }
      if (!rightKeys.size) return;
      // Prefer columns that look like IDs on the right (mostly unique) and share many values.
      const score = hits / rightKeys.size + (norm(h) === norm(col.name) ? 1 : 0) + (rightKeys.size / Math.max(1, Math.min(other.rows.length, 5000)) > 0.9 ? 0.25 : 0);
      if (hits > 0 && (!best || score > best.score)) best = { leftKey: col.name, rightKey: h, score };
    });
  }
  return best;
}
