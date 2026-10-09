// Descriptive statistics, histograms, correlation and regression.

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function numbers(values) {
  const out = [];
  for (const v of values) if (isNum(v)) out.push(v);
  return out;
}

export function sum(xs) {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs) {
  return xs.length ? sum(xs) / xs.length : NaN;
}

/** Linear-interpolated quantile of an already sorted array (same method as Excel's PERCENTILE.INC). */
export function quantileSorted(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function median(xs) {
  return quantileSorted([...xs].sort((a, b) => a - b), 0.5);
}

/** Sample variance (divides by n - 1). */
export function variance(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / (xs.length - 1);
}

export function std(xs) {
  return Math.sqrt(variance(xs));
}

/** Skewness: > 0 means a long tail to the right, < 0 a long tail to the left. */
export function skewness(xs) {
  const n = xs.length;
  if (n < 3) return NaN;
  const m = mean(xs);
  let m2 = 0;
  let m3 = 0;
  for (const x of xs) {
    const d = x - m;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= n;
  m3 /= n;
  return m2 === 0 ? 0 : m3 / m2 ** 1.5;
}

/** Full numeric summary of a list of numbers. */
export function describe(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return { count: 0 };
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  let outliers = 0;
  for (const x of sorted) if (x < lowerFence || x > upperFence) outliers++;
  return {
    count: n,
    sum: sum(sorted),
    mean: mean(sorted),
    std: std(sorted),
    min: sorted[0],
    q1,
    median: quantileSorted(sorted, 0.5),
    q3,
    max: sorted[n - 1],
    iqr,
    skew: skewness(sorted),
    lowerFence,
    upperFence,
    outliers,
  };
}

/** Count how often each value occurs, most common first. */
export function frequencies(values) {
  const counts = new Map();
  for (const v of values) {
    if (v == null) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

function decimalsFor(step) {
  return Math.max(0, -Math.floor(Math.log10(step)) + 1);
}

/** A "nice" step size (1, 2 or 5 × 10^k) that splits `range` into roughly `count` pieces. */
export function niceStep(range, count = 5) {
  const raw = range / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

/** Evenly spaced round numbers covering [min, max]. */
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const step = niceStep(max - min, count);
  const dec = decimalsFor(step);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step * 1e-9; v += step) ticks.push(Number(v.toFixed(dec)));
  return ticks;
}

/** Histogram bins with round-number edges. Bin count follows Sturges' rule. */
export function histogram(xs, targetBins) {
  if (!xs.length) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const x of xs) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  if (min === max) return [{ x0: min, x1: max, count: xs.length }];
  const bins = targetBins || Math.min(40, Math.max(5, Math.ceil(Math.log2(xs.length) + 1)));
  const edges = niceTicks(min, max, bins);
  const step = edges[1] - edges[0];
  const out = edges.slice(0, -1).map((x0, i) => ({ x0, x1: edges[i + 1], count: 0 }));
  for (const x of xs) {
    let i = Math.floor((x - edges[0]) / step);
    if (i >= out.length) i = out.length - 1;
    if (i < 0) i = 0;
    out[i].count++;
  }
  return out;
}

/** Pairs of numbers where both sides are present. */
export function pairs(xValues, yValues) {
  const xs = [];
  const ys = [];
  for (let i = 0; i < xValues.length; i++) {
    if (isNum(xValues[i]) && isNum(yValues[i])) {
      xs.push(xValues[i]);
      ys.push(yValues[i]);
    }
  }
  return { xs, ys };
}

/** Pearson correlation coefficient (-1 … 1), ignoring rows with a missing value on either side. */
export function pearson(xValues, yValues) {
  const { xs, ys } = pairs(xValues, yValues);
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

/** Least-squares line y = slope * x + intercept, plus R² (share of variation explained). */
export function linearRegression(xValues, yValues) {
  const { xs, ys } = pairs(xValues, yValues);
  const n = xs.length;
  if (n < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, n };
}

/** Correlation between every pair of numeric columns. */
export function correlationMatrix(columns) {
  const names = columns.map((c) => c.name);
  const matrix = columns.map((a, i) => columns.map((b, j) => (i === j ? 1 : pearson(a.values, b.values))));
  return { names, matrix };
}

/** Plain-English label for the strength of a correlation. */
export function correlationStrength(r) {
  const a = Math.abs(r);
  if (!Number.isFinite(a)) return 'unknown';
  if (a >= 0.7) return 'strong';
  if (a >= 0.4) return 'moderate';
  if (a >= 0.2) return 'weak';
  return 'little or no';
}
