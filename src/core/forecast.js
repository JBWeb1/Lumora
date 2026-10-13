// Simple, honest forecasting for date-based line charts.
//
// Method: Holt-Winters exponential smoothing (level + damped trend + optional repeating
// pattern: weekly for daily data, yearly for monthly data). Smoothing settings are picked
// automatically by trying a grid and keeping the one with the smallest one-step errors.
// The "likely range" is an 80% prediction interval. Before trusting it, we back-test:
// hide the most recent stretch, forecast it, and report how far off we were.

const DAY = 86400000;
const Z80 = 1.2816;

export const HORIZONS = {
  day: [[7, '1 week'], [14, '2 weeks'], [30, '30 days'], [90, '90 days']],
  month: [[3, '3 months'], [6, '6 months'], [12, '12 months']],
  year: [[1, '1 year'], [3, '3 years'], [5, '5 years']],
};
export const DEFAULT_HORIZON = { day: 30, month: 6, year: 3 };

/** The start of the bucket after `t`. */
export function nextBucket(t, unit) {
  if (unit === 'day') return t + DAY;
  const d = new Date(t);
  if (unit === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
}

/** Put the series on a regular calendar, filling short gaps by straight-line interpolation. */
export function regularize(points, unit) {
  const byX = new Map(points.map((p) => [p.x, p.y]));
  const out = [];
  for (let t = points[0].x; t <= points[points.length - 1].x; t = nextBucket(t, unit)) out.push({ x: t, y: byX.has(t) ? byX.get(t) : null });
  const missing = out.filter((p) => p.y == null).length;
  for (let i = 0; i < out.length; i++) {
    if (out[i].y != null) continue;
    let j = i;
    while (out[j].y == null) j++;
    const a = out[i - 1];
    const b = out[j];
    for (let k = i; k < j; k++) out[k].y = a.y + ((b.y - a.y) * (k - i + 1)) / (j - i + 1);
    i = j;
  }
  return { series: out, missing };
}

const GRID = {
  alpha: [0.05, 0.15, 0.3, 0.5, 0.7, 0.9],
  beta: [0.01, 0.05, 0.15, 0.3],
  gamma: [0.05, 0.15, 0.3],
  phi: [0.9, 0.98],
};

function fit(y, m, { alpha, beta, gamma, phi }) {
  const n = y.length;
  let level;
  let trend;
  const season = new Array(n + m).fill(0);
  if (m) {
    const first = y.slice(0, m).reduce((s, v) => s + v, 0) / m;
    const second = y.slice(m, 2 * m).reduce((s, v) => s + v, 0) / m;
    level = first;
    trend = (second - first) / m;
    for (let i = 0; i < m; i++) season[i] = y[i] - first;
  } else {
    level = y[0];
    trend = y[1] - y[0];
  }
  let sse = 0;
  let count = 0;
  const start = m || 1;
  for (let t = start; t < n; t++) {
    const s = m ? season[t - m] : 0;
    const predicted = level + phi * trend + s;
    const err = y[t] - predicted;
    sse += err * err;
    count++;
    const prevLevel = level;
    level = alpha * (y[t] - s) + (1 - alpha) * (prevLevel + phi * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
    if (m) season[t] = gamma * (y[t] - level) + (1 - gamma) * s;
  }
  return { level, trend, season, sse, count };
}

function bestFit(y, m) {
  let best = null;
  for (const alpha of GRID.alpha) {
    for (const beta of GRID.beta) {
      for (const phi of GRID.phi) {
        for (const gamma of m ? GRID.gamma : [0]) {
          const params = { alpha, beta, gamma, phi };
          const f = fit(y, m, params);
          if (!best || f.sse < best.sse) best = { ...f, params };
        }
      }
    }
  }
  return best;
}

function project(model, y, m, horizon) {
  const { level, trend, season, params } = model;
  const n = y.length;
  const sigma = Math.sqrt(model.sse / Math.max(1, model.count));
  const out = [];
  let damp = 0;
  for (let h = 1; h <= horizon; h++) {
    damp += params.phi ** h;
    const s = m ? season[n - m + ((h - 1) % m)] : 0;
    const yhat = level + damp * trend + s;
    // Standard Holt variance approximation; it widens the further ahead we look.
    const { alpha, beta } = params;
    const v = sigma * sigma * (1 + (h - 1) * alpha * alpha * (1 + h * beta + (h * (2 * h - 1) * beta * beta) / 6));
    out.push({ yhat, sd: Math.sqrt(v) });
  }
  return { out, sigma };
}

function seasonFor(unit, n) {
  if (unit === 'day' && n >= 21) return 7;
  if (unit === 'month' && n >= 24) return 12;
  return 0;
}

/**
 * Forecast a date series. `points` are { x: bucket start (ms), y } sorted by x.
 * Returns { points: [{ x, y, lo, hi }], period, horizon, total, accuracy, note } or { error }.
 */
export function forecastSeries(points, { unit, horizon = DEFAULT_HORIZON[unit] }) {
  if (!['day', 'month', 'year'].includes(unit)) return { error: 'Forecasts need dates on the X axis.' };
  const usable = points.filter((p) => Number.isFinite(p.y));
  if (usable.length < 8) return { error: `A forecast needs at least 8 ${unit}s of history; this has ${usable.length}.` };
  const { series, missing } = regularize(usable, unit);
  if (missing / series.length > 0.3) return { error: 'Too many gaps in the dates to forecast reliably.' };
  const y = series.map((p) => p.y);
  const m = seasonFor(unit, y.length);
  const nonNegative = y.every((v) => v >= 0);
  const clamp = (v) => (nonNegative ? Math.max(0, v) : v);

  const model = bestFit(y, m);
  const { out } = project(model, y, m, horizon);
  const pts = [];
  let t = series[series.length - 1].x;
  for (const f of out) {
    t = nextBucket(t, unit);
    pts.push({ x: t, y: clamp(f.yhat), lo: clamp(f.yhat - Z80 * f.sd), hi: clamp(f.yhat + Z80 * f.sd) });
  }

  // Back-test: forecast the most recent `horizon` periods from the data before them.
  let accuracy = null;
  const testLen = Math.min(horizon, Math.floor(y.length / 3));
  if (testLen >= 2 && y.length - testLen >= Math.max(8, 2 * (m || 1))) {
    const train = y.slice(0, y.length - testLen);
    const tm = seasonFor(unit, train.length);
    const back = project(bestFit(train, tm), train, tm, testLen).out;
    const actual = y.slice(y.length - testLen);
    const absErr = actual.map((a, i) => Math.abs(a - clamp(back[i].yhat)));
    const mae = absErr.reduce((s, v) => s + v, 0) / testLen;
    const scale = actual.reduce((s, v) => s + Math.abs(v), 0) / testLen;
    accuracy = { periods: testLen, mae, pctError: scale ? mae / scale : null };
  }

  const sum = pts.reduce((s, p) => s + p.y, 0);
  const sumSd = Math.sqrt(out.reduce((s, f) => s + f.sd * f.sd, 0));
  return {
    points: pts,
    unit,
    horizon,
    period: m,
    total: { y: sum, lo: clamp(sum - Z80 * sumSd), hi: sum + Z80 * sumSd },
    average: sum / pts.length,
    accuracy,
    filledGaps: missing,
    note: m ? `Follows the recent trend and the ${m === 7 ? 'weekly' : 'yearly'} pattern.` : 'Follows the recent trend (not enough history to learn a repeating pattern).',
  };
}
