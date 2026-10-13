// The numbers behind the Overview tab, in one place so they can be computed either on
// the page or in the background worker (which does it while a big file is loading).

import { generateInsights } from './insights.js';
import { correlationMatrix, describe, extent, frequencies, histogram, numbers } from './stats.js';

/** Overview analyses look at up to this many rows, spread evenly through the data. */
export const OVERVIEW_SAMPLE = 50_000;

/** An evenly spread subset of row indices (all of them when there are few). */
export function evenSample(rows, n) {
  if (rows.length <= n) return rows;
  const step = rows.length / n;
  return Array.from({ length: n }, (_, k) => rows[Math.floor(k * step)]);
}

/** Small, plain summary for a column card: exact missing share, everything else from the sample. */
export function columnSummary(col, rows, sample) {
  let missing = 0;
  for (const i of rows) if (col.values[i] == null) missing++;
  const present = [];
  for (const i of sample) if (col.values[i] != null) present.push(col.values[i]);
  const out = { missingPct: rows.length ? (missing / rows.length) * 100 : 0, count: present.length };
  if (!present.length) return out;
  if (col.type === 'number') {
    const d = describe(present);
    out.stats = { mean: d.mean, median: d.median, min: d.min, max: d.max };
    out.bins = histogram(present, 16);
  } else if (col.type === 'date') {
    out.range = extent(numbers(present));
  } else {
    const freq = frequencies(present);
    out.top = freq.slice(0, 4);
    out.distinct = freq.length;
  }
  return out;
}

/** Everything the Overview needs for a set of rows. */
export function overviewData(dataset, rows) {
  const sample = evenSample(rows, OVERVIEW_SAMPLE);
  const numeric = dataset.columns.filter((c) => c.type === 'number').slice(0, 12);
  let missing = 0;
  for (const col of dataset.columns) for (const i of rows) if (col.values[i] == null) missing++;
  return {
    missing,
    insights: generateInsights(dataset, sample),
    cards: dataset.columns.map((col) => columnSummary(col, rows, sample)),
    corr: numeric.length >= 2 ? correlationMatrix(numeric.map((col) => ({ name: col.name, values: sample.map((i) => col.values[i]) }))) : null,
  };
}
