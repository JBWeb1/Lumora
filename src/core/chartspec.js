// Picks a sensible chart for the chosen columns and prepares the data to draw.

import { dateBucket, aggregate, groupKey } from './transform.js';
import { describe, frequencies, histogram, isNum, linearRegression, pearson } from './stats.js';

export const CHART_TYPES = {
  histogram: { label: 'Histogram', term: 'histogram' },
  bar: { label: 'Bar chart', term: 'bar' },
  scatter: { label: 'Scatter plot', term: 'scatter' },
  line: { label: 'Line chart', term: 'line' },
  box: { label: 'Box plot', term: 'box' },
};

const isGroupable = (c) => c && (c.type === 'category' || c.type === 'boolean' || c.type === 'text');

/** Choose the most informative chart for the selected columns and explain why. */
export function suggestChart(xCol, yCol) {
  if (!xCol) return { type: null, reason: 'Pick a column to plot.' };
  if (!yCol) {
    if (xCol.type === 'number') return { type: 'histogram', reason: `A histogram shows how the values of ${xCol.name} are distributed: where they cluster and how spread out they are.` };
    if (xCol.type === 'date') return { type: 'line', reason: `A line chart counts rows over time, showing when activity in ${xCol.name} rises and falls.` };
    return { type: 'bar', reason: `A bar chart counts how many rows fall into each value of ${xCol.name}.` };
  }
  const xt = xCol.type;
  const yt = yCol.type;
  if (xt === 'number' && yt === 'number') return { type: 'scatter', reason: `Both columns are numbers, so a scatter plot shows whether ${yCol.name} rises or falls with ${xCol.name}.` };
  if (xt === 'date' && yt === 'number') return { type: 'line', reason: `${xCol.name} is a date, so a line chart shows how ${yCol.name} changes over time.` };
  if (isGroupable(xCol) && yt === 'number') return { type: 'bar', reason: `A bar chart compares ${yCol.name} across each group of ${xCol.name}. Switch to a box plot to see the spread within each group too.` };
  if (xt === 'number' && isGroupable(yCol)) return { type: 'box', reason: `Box plots compare the distribution of ${xCol.name} for each group of ${yCol.name}.` };
  return { type: 'bar', reason: `Counting rows for each value of ${xCol.name}. To compare a measurement, choose a number column for Y.` };
}

function pickDateUnit(timestamps) {
  if (!timestamps.length) return 'day';
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of timestamps) {
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  const days = (hi - lo) / 86400000;
  return days <= 400 ? 'day' : days <= 3650 ? 'month' : 'year';
}

function bucketStart(label, unit) {
  if (unit === 'year') return Date.UTC(+label, 0, 1);
  if (unit === 'month') return Date.UTC(+label.slice(0, 4), +label.slice(5, 7) - 1, 1);
  return Date.parse(`${label}T00:00:00Z`);
}

/** Centered moving average of a sorted series. */
export function movingAverage(points, window) {
  const half = Math.floor(window / 2);
  return points.map((p, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(points.length, i + half + 1);
    let s = 0;
    for (let k = lo; k < hi; k++) s += points[k].y;
    return { x: p.x, y: s / (hi - lo) };
  });
}

const MAX_BARS = 30;
const MAX_POINTS = 5000;

/**
 * Prepare chart data. Returns { type, ...data } or { error } when the columns don't fit the chart.
 * options: { type, x, y, agg }  (x / y are column indices; y may be null)
 */
export function buildChartData(dataset, indices, { type, x, y = null, agg = 'mean' }) {
  let xCol = dataset.columns[x];
  let yCol = y == null ? null : dataset.columns[y];
  if (!xCol) return { error: 'Pick a column for the X axis.' };
  const col = (c) => indices.map((i) => c.values[i]);

  if (type === 'histogram') {
    if (xCol.type !== 'number') return { error: `A histogram needs a number column. ${xCol.name} is ${xCol.type}.` };
    const xs = col(xCol).filter(isNum);
    if (!xs.length) return { error: 'No numbers to plot.' };
    return { type, xLabel: xCol.name, bins: histogram(xs), stats: describe(xs) };
  }

  if (type === 'scatter') {
    if (!yCol || xCol.type !== 'number' || yCol.type !== 'number') return { error: 'A scatter plot needs two number columns (X and Y).' };
    const xv = col(xCol);
    const yv = col(yCol);
    let points = [];
    for (let k = 0; k < xv.length; k++) if (isNum(xv[k]) && isNum(yv[k])) points.push({ x: xv[k], y: yv[k], row: indices[k] });
    if (!points.length) return { error: 'No rows have both values.' };
    const total = points.length;
    if (points.length > MAX_POINTS) {
      const step = points.length / MAX_POINTS;
      points = Array.from({ length: MAX_POINTS }, (_, k) => points[Math.floor(k * step)]);
    }
    return { type, xLabel: xCol.name, yLabel: yCol.name, points, total, regression: linearRegression(xv, yv), r: pearson(xv, yv) };
  }

  if (type === 'line') {
    if (xCol.type !== 'date' && xCol.type !== 'number') return { error: 'A line chart needs a date or number column on the X axis.' };
    if (yCol && yCol.type !== 'number') return { error: 'The Y axis of a line chart must be a number column.' };
    const xv = col(xCol);
    const yv = yCol ? col(yCol) : null;
    const unit = xCol.type === 'date' ? pickDateUnit(xv.filter(isNum)) : null;
    const groups = new Map();
    xv.forEach((v, k) => {
      if (!isNum(v)) return;
      const key = unit ? dateBucket(v, unit) : v;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(yv ? yv[k] : 1);
    });
    const fn = yCol ? agg : 'count';
    const points = [...groups.entries()]
      .map(([key, vals]) => ({ x: unit ? bucketStart(key, unit) : key, y: aggregate(vals, fn) }))
      .filter((p) => isNum(p.y))
      .sort((a, b) => a.x - b.x);
    if (!points.length) return { error: 'Nothing to plot.' };
    // Busy series get a moving average so the trend shows through the noise.
    const window = points.length > 60 ? (unit === 'day' ? 7 : Math.max(3, Math.round(points.length / 20) | 1)) : 0;
    const smooth = window ? movingAverage(points, window) : null;
    return { type, xLabel: xCol.name, yLabel: yCol ? `${agg} of ${yCol.name}` : 'Rows', xIsDate: xCol.type === 'date', unit, points, smooth, window };
  }

  if (type === 'box') {
    // Accept (number) or (category, number) or (number, category).
    if (xCol.type === 'number' && isGroupable(yCol)) [xCol, yCol] = [yCol, xCol];
    if (!yCol) {
      if (xCol.type !== 'number') return { error: 'A box plot needs a number column.' };
      const xs = col(xCol).filter(isNum);
      if (!xs.length) return { error: 'No numbers to plot.' };
      return { type, valueLabel: xCol.name, groups: [{ label: xCol.name, stats: describe(xs), values: xs }] };
    }
    if (yCol.type !== 'number') return { error: 'A box plot needs a number column to summarise.' };
    const gv = col(xCol);
    const yv = col(yCol);
    const groups = new Map();
    gv.forEach((g, k) => {
      if (!isNum(yv[k])) return;
      const key = groupKey(xCol, g, 'month');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(yv[k]);
    });
    const list = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 15)
      .map(([label, xs]) => ({ label: String(label), stats: describe(xs), values: xs }))
      .sort((a, b) => b.stats.median - a.stats.median);
    if (!list.length) return { error: 'Nothing to plot.' };
    return { type, groupLabel: xCol.name, valueLabel: yCol.name, groups: list, truncated: groups.size > 15 };
  }

  if (type === 'bar') {
    if (yCol && yCol.type !== 'number') yCol = null;
    const gv = col(xCol);
    let bars;
    if (!yCol) {
      bars = frequencies(gv.map((v) => (v == null ? null : groupKey(xCol, v, 'month')))).map((f) => ({ label: String(f.value), value: f.count }));
    } else {
      const yv = col(yCol);
      const groups = new Map();
      gv.forEach((g, k) => {
        const key = groupKey(xCol, g, 'month');
        if (key === '(missing)') return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(yv[k]);
      });
      bars = [...groups.entries()].map(([label, vals]) => ({ label: String(label), value: aggregate(vals, agg) })).filter((b) => isNum(b.value));
      bars.sort((a, b) => b.value - a.value);
    }
    if (!bars.length) return { error: 'Nothing to plot.' };
    if (xCol.type === 'number' || xCol.type === 'date') bars.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    const total = bars.length;
    return { type, xLabel: xCol.name, valueLabel: yCol ? `${agg} of ${yCol.name}` : 'Rows', bars: bars.slice(0, MAX_BARS), total };
  }

  return { error: 'Choose a chart type.' };
}
