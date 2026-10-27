// More goal-first analyses: natural groups, what-if, return rates, funnels,
// trend vs pattern and delayed effects. Same contract as analyses.js:
// (dataset, row indices, settings by column name) → { answer, ..., chart? } or { error }.

import { mean, median, numbers, pearson } from './stats.js';
import { dateBucket, formatNumber } from './transform.js';
import { autoUnit, bucketLabel, colByName, defaultMeasure, groupingColumns } from './analyses.js';

const pct = (x) => `${Math.round(x * 100)}%`;
const DAY = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Seeded random numbers, so the same data always gives the same groups. */
function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Number columns worth using as measurements (not row numbers or IDs). */
export function measureColumns(ds, indices) {
  return ds.columns.filter((c) => {
    if (c.type !== 'number') return false;
    const xs = numbers(indices.slice(0, 5000).map((i) => c.values[i]));
    if (xs.length < 5) return false;
    const distinct = new Set(xs).size;
    const looksLikeId = /(^|[\s_])(id|no|number|code|index|#)$/i.test(c.name.trim()) || (distinct === xs.length && xs.every((x, k) => k === 0 || x > xs[k - 1]));
    return !looksLikeId && distinct > 1;
  });
}

const evenSample = (indices, max) => {
  if (indices.length <= max) return indices;
  const step = indices.length / max;
  return Array.from({ length: max }, (_, k) => indices[Math.floor(k * step)]);
};

// ---------- 6. natural groups (k-means) ----------

function standardize(ds, rows, cols) {
  const stats = cols.map((c) => {
    const xs = numbers(rows.map((i) => c.values[i]));
    const m = mean(xs);
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)) || 1;
    return { m, sd, med: median(xs) };
  });
  const points = rows.map((i) => cols.map((c, j) => ((c.values[i] ?? stats[j].med) - stats[j].m) / stats[j].sd));
  return { points, stats };
}

const dist2 = (a, b) => {
  let s = 0;
  for (let j = 0; j < a.length; j++) s += (a[j] - b[j]) ** 2;
  return s;
};

function kmeans(points, k, random) {
  // k-means++ start: spread the first centres out.
  const centres = [points[Math.floor(random() * points.length)]];
  while (centres.length < k) {
    const d = points.map((p) => Math.min(...centres.map((c) => dist2(p, c))));
    const sumD = d.reduce((s, x) => s + x, 0);
    let r = random() * sumD;
    let pick = 0;
    for (; pick < d.length - 1 && r > d[pick]; pick++) r -= d[pick];
    centres.push(points[pick]);
  }
  let assign = new Array(points.length).fill(0);
  for (let iter = 0; iter < 50; iter++) {
    const next = points.map((p) => {
      let best = 0;
      let bd = Infinity;
      centres.forEach((c, j) => {
        const dd = dist2(p, c);
        if (dd < bd) {
          bd = dd;
          best = j;
        }
      });
      return best;
    });
    const moved = next.some((a, i) => a !== assign[i]);
    assign = next;
    for (let j = 0; j < k; j++) {
      const members = points.filter((_, i) => assign[i] === j);
      if (members.length) centres[j] = members[0].map((_, f) => mean(members.map((m) => m[f])));
    }
    if (!moved && iter > 0) break;
  }
  return { assign, centres };
}

/** Average silhouette (on a sample): how well separated the groups are, −1..1. */
function silhouette(points, assign, k) {
  const n = Math.min(points.length, 600);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const own = assign[i];
    const sums = new Array(k).fill(0);
    const counts = new Array(k).fill(0);
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      sums[assign[j]] += Math.sqrt(dist2(points[i], points[j]));
      counts[assign[j]]++;
    }
    const a = counts[own] ? sums[own] / counts[own] : 0;
    let b = Infinity;
    for (let c = 0; c < k; c++) if (c !== own && counts[c]) b = Math.min(b, sums[c] / counts[c]);
    total += b === Infinity ? 0 : (b - a) / Math.max(a, b);
  }
  return total / n;
}

const LEVEL = (z) => (z >= 1 ? 'very high' : z >= 0.4 ? 'high' : z <= -1 ? 'very low' : z <= -0.4 ? 'low' : null);

/** Group labels for every row (rows outside `indices` get null): used by the "save as column" step. */
export function findGroups(ds, indices, { columns, k } = {}) {
  const usable = measureColumns(ds, indices);
  const cols = (columns?.length ? columns.map((n) => usable.find((c) => c.name === n)).filter(Boolean) : usable).slice(0, 8);
  if (cols.length < 2) return { error: 'Finding natural groups needs at least two number columns that measure something (not IDs).' };
  const rows = indices.filter((i) => cols.filter((c) => c.values[i] != null).length >= Math.ceil(cols.length / 2));
  if (rows.length < 12) return { error: 'Finding natural groups needs at least 12 rows with numbers.' };
  const fitRows = evenSample(rows, 3000);
  const { points, stats } = standardize(ds, fitRows, cols);
  const random = rng(7);
  let best = null;
  for (const kk of k ? [Math.max(2, Math.min(8, k))] : [2, 3, 4, 5]) {
    if (kk >= fitRows.length / 3) continue;
    const run = kmeans(points, kk, random);
    const score = silhouette(points, run.assign, kk);
    if (!best || score > best.score + 0.02) best = { ...run, k: kk, score };
  }
  // Give every row (not just the sample) its nearest group.
  const label = new Array(ds.rowCount).fill(null);
  const counts = new Array(best.k).fill(0);
  for (const i of rows) {
    const p = cols.map((c, j) => ((c.values[i] ?? stats[j].med) - stats[j].m) / stats[j].sd);
    let g = 0;
    let bd = Infinity;
    best.centres.forEach((c, j) => {
      const dd = dist2(p, c);
      if (dd < bd) {
        bd = dd;
        g = j;
      }
    });
    label[i] = g;
    counts[g]++;
  }
  // Order groups biggest first and describe each by what sets it apart.
  const order = counts.map((n, g) => [n, g]).sort((a, b) => b[0] - a[0]).map(([, g]) => g);
  const groups = order.map((g, rank) => {
    const members = rows.filter((i) => label[i] === g);
    const traits = cols.map((c, j) => {
      const m = mean(numbers(members.map((i) => c.values[i])));
      return { column: c.name, mean: m, overall: stats[j].m, z: (m - stats[j].m) / stats[j].sd };
    }).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    const words = traits.filter((t) => LEVEL(t.z)).slice(0, 2).map((t) => `${LEVEL(t.z)} ${t.column}`);
    return { id: g, number: rank + 1, size: members.length, share: members.length / rows.length, name: words.length ? words.join(', ') : 'about average', traits };
  });
  const rename = new Map(order.map((g, rank) => [g, `Group ${rank + 1}`]));
  const answer = `Lumora found ${groups.length} natural groups in ${cols.length} number columns: ${groups.map((g) => `Group ${g.number} (${pct(g.share)} of rows) has ${g.name}`).join('; ')}.`;
  // Chart: the two columns that separate the groups most.
  const spread = cols.map((c) => ({ c, s: Math.max(...groups.map((g) => Math.abs(g.traits.find((t) => t.column === c.name).z))) })).sort((a, b) => b.s - a.s);
  const [xc, yc] = [spread[0].c, spread[1].c];
  const shown = evenSample(rows, 2000).filter((i) => xc.values[i] != null && yc.values[i] != null);
  return {
    answer,
    quality: best.score >= 0.5 ? 'clearly separated' : best.score >= 0.25 ? 'reasonably separated' : 'overlapping (treat them as rough groupings)',
    columns: cols.map((c) => c.name),
    columnOptions: usable.map((c) => c.name),
    k: best.k,
    groups,
    labels: label.map((g) => (g == null ? null : rename.get(g))),
    chart: {
      type: 'scatter', xLabel: xc.name, yLabel: yc.name,
      points: shown.map((i) => ({ x: xc.values[i], y: yc.values[i], row: i, g: order.indexOf(label[i]) })),
      legend: groups.map((g) => ({ label: `Group ${g.number}` })),
    },
  };
}

// ---------- 7. what-if ----------

/** Solve (XᵀX + λI) b = Xᵀy by Gaussian elimination. */
function leastSquares(X, y, lambda = 1e-6) {
  const p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  for (let r = 0; r < X.length; r++) {
    const x = X[r];
    for (let i = 0; i < p; i++) {
      A[i][p] += x[i] * y[r];
      for (let j = 0; j < p; j++) A[i][j] += x[i] * x[j];
    }
  }
  for (let i = 1; i < p; i++) A[i][i] += lambda * X.length;
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) continue;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[p] / row[i]));
}

export function whatIfModel(ds, indices, { target, inputs } = {}) {
  const numberCols = measureColumns(ds, indices);
  const targetCol = colByName(ds, target) ?? colByName(ds, defaultMeasure(ds)) ?? numberCols[0];
  if (!targetCol || targetCol.type !== 'number') return { error: 'What-if needs a number column to predict, such as sales or score.' };
  const rows = evenSample(indices.filter((i) => targetCol.values[i] != null), 20000);
  if (rows.length < 15) return { error: `Predicting ${targetCol.name} needs at least 15 rows where it is filled in.` };
  const ty = rows.map((i) => targetCol.values[i]);

  // Candidate inputs: number columns most related to the target, yes/no columns and small categories.
  const candidates = [];
  for (const c of numberCols) {
    if (c === targetCol) continue;
    const r = pearson(rows.map((i) => c.values[i]), ty);
    if (Number.isFinite(r)) candidates.push({ c, kind: 'number', strength: Math.abs(r) });
  }
  for (const c of ds.columns) {
    if (c.type !== 'boolean' && c.type !== 'category') continue;
    const levels = [...new Set(rows.map((i) => c.values[i]).filter((v) => v != null))];
    if (levels.length < 2 || levels.length > 8) continue;
    candidates.push({ c, kind: c.type === 'boolean' ? 'yesno' : 'category', strength: 0.15, levels });
  }
  const chosen = inputs?.length
    ? inputs.map((n) => candidates.find((x) => x.c.name === n)).filter(Boolean)
    : candidates.sort((a, b) => b.strength - a.strength).slice(0, 5);
  if (!chosen.length) return { error: `There are no other columns to predict ${targetCol.name} from.` };

  const specs = chosen.map(({ c, kind, levels }) => {
    if (kind === 'number') {
      const xs = numbers(rows.map((i) => c.values[i]));
      const sorted = [...xs].sort((a, b) => a - b);
      return { name: c.name, kind, min: sorted[0], max: sorted[sorted.length - 1], typical: median(xs), sd: Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1)) };
    }
    if (kind === 'yesno') {
      const yes = rows.filter((i) => c.values[i] === true).length;
      return { name: c.name, kind, typical: yes >= rows.length / 2 };
    }
    const counts = new Map();
    for (const i of rows) if (c.values[i] != null) counts.set(c.values[i], (counts.get(c.values[i]) ?? 0) + 1);
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => String(v));
    return { name: c.name, kind, levels: ordered, base: ordered[0], typical: ordered[0] };
  });
  const encode = (get) => [1, ...specs.flatMap((s) => {
    const v = get(s);
    if (s.kind === 'number') return [v ?? s.typical];
    if (s.kind === 'yesno') return [(v ?? s.typical) ? 1 : 0];
    return s.levels.slice(1).map((l) => (String(v ?? s.typical) === l ? 1 : 0));
  })];
  const X = rows.map((i) => encode((s) => colByName(ds, s.name).values[i]));
  const coef = leastSquares(X, ty);
  const fitted = X.map((x) => x.reduce((s, v, j) => s + v * coef[j], 0));
  const my = mean(ty);
  const ssTot = ty.reduce((s, v) => s + (v - my) ** 2, 0);
  const ssRes = ty.reduce((s, v, k) => s + (v - fitted[k]) ** 2, 0);
  const r2 = ssTot ? Math.max(0, 1 - ssRes / ssTot) : 0;
  const residSd = Math.sqrt(ssRes / Math.max(1, rows.length - coef.length));

  // Attach each input's coefficients, and describe the strongest effects in words.
  let j = 1;
  for (const s of specs) {
    if (s.kind === 'category') {
      s.effects = Object.fromEntries([[s.base, 0], ...s.levels.slice(1).map((l) => [l, coef[j++]])]);
      s.impact = Math.max(...Object.values(s.effects)) - Math.min(...Object.values(s.effects));
    } else {
      s.coef = coef[j++];
      s.impact = Math.abs(s.coef) * (s.kind === 'number' ? s.sd : 1);
    }
  }
  const ranked = [...specs].sort((a, b) => b.impact - a.impact);
  const say = (s) => {
    if (s.kind === 'number') return `each extra 1 of ${s.name} goes with ${s.coef >= 0 ? 'about' : 'about'} ${formatNumber(Math.abs(s.coef))} ${s.coef >= 0 ? 'more' : 'less'} ${targetCol.name}`;
    if (s.kind === 'yesno') return `“yes” for ${s.name} goes with about ${formatNumber(Math.abs(s.coef))} ${s.coef >= 0 ? 'more' : 'less'} ${targetCol.name}`;
    const [hiL, hiV] = Object.entries(s.effects).sort((a, b) => b[1] - a[1])[0];
    const [loL, loV] = Object.entries(s.effects).sort((a, b) => a[1] - b[1])[0];
    return `${s.name} “${hiL}” goes with about ${formatNumber(hiV - loV)} more ${targetCol.name} than “${loL}”`;
  };
  const fit = r2 >= 0.7 ? 'well' : r2 >= 0.4 ? 'partly' : 'only a little';
  const answer = `These ${specs.length} columns explain ${fit} why ${targetCol.name} goes up and down (${pct(r2)} of it). Holding the others steady, ${ranked.slice(0, 2).map(say).join(', and ')}.`;
  return {
    answer,
    caution: 'This shows how things move together in your data, not proof that changing one causes the other.',
    target: targetCol.name,
    targetOptions: numberCols.map((c) => c.name),
    inputs: specs,
    inputOptions: candidates.map((x) => x.c.name),
    intercept: coef[0],
    r2,
    residSd,
    n: rows.length,
    typical: my,
  };
}

/** Predict with a what-if model. `values` maps input names to chosen values. Returns { value, lo, hi }. */
export function predictWhatIf(model, values) {
  let y = model.intercept;
  for (const s of model.inputs) {
    const v = values[s.name] ?? s.typical;
    if (s.kind === 'number') y += s.coef * Number(v);
    else if (s.kind === 'yesno') y += (v === true || v === 'yes') ? s.coef : 0;
    else y += s.effects[String(v)] ?? 0;
  }
  const band = 1.2816 * model.residSd;
  return { value: y, lo: y - band, hi: y + band };
}

// ---------- 8. return rates (cohorts) ----------

export function idColumns(ds, indices) {
  return ds.columns.filter((c) => {
    if (!['category', 'text', 'number'].includes(c.type)) return false;
    // A number column only identifies people if it is called an ID (a "customers" count doesn't).
    if (c.type === 'number' && !/(^|[\s_])(id|no|number|code|member|customer_?id)$/i.test(c.name.trim())) return false;
    const seen = new Set();
    let repeats = 0;
    for (const i of evenSample(indices, 20000)) {
      const v = c.values[i];
      if (v == null) continue;
      if (seen.has(v)) repeats++;
      else seen.add(v);
    }
    return seen.size >= 5 && repeats > 0 && seen.size >= indices.length * 0.02;
  });
}

export function returnRates(ds, indices, { customer, date, months = 6 } = {}) {
  const dateCol = colByName(ds, date) ?? ds.columns.find((c) => c.type === 'date');
  if (!dateCol) return { error: 'Return rates need a date column (when each visit or purchase happened).' };
  const ids = idColumns(ds, indices).filter((c) => c !== dateCol);
  const idCol = colByName(ds, customer) ?? ids.find((c) => /customer|client|user|member|email|account|name|id/i.test(c.name)) ?? ids[0];
  if (!idCol) return { error: 'Return rates need a column that identifies who each row is about (a customer, member or user), with people appearing more than once.' };
  const first = new Map();
  const active = new Map(); // id → set of month numbers
  const monthNo = (t) => {
    const d = new Date(t);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  };
  for (const i of indices) {
    const id = idCol.values[i];
    const t = dateCol.values[i];
    if (id == null || t == null) continue;
    const m = monthNo(t);
    if (!first.has(id) || m < first.get(id)) first.set(id, m);
    if (!active.has(id)) active.set(id, new Set());
    active.get(id).add(m);
  }
  if (first.size < 5) return { error: `Return rates need at least 5 different ${idCol.name} values.` };
  const lastMonth = Math.max(...[...first.values()], ...[...active.values()].flatMap((s) => [...s]));
  const cohorts = new Map();
  for (const [id, m0] of first) {
    if (!cohorts.has(m0)) cohorts.set(m0, []);
    cohorts.get(m0).push(id);
  }
  const offsets = Math.min(months, 12);
  const table = [...cohorts.entries()].sort((a, b) => a[0] - b[0]).map(([m0, members]) => {
    const rates = [];
    for (let k = 1; k <= offsets; k++) {
      if (m0 + k > lastMonth) {
        rates.push(null);
        continue;
      }
      const back = members.filter((id) => active.get(id).has(m0 + k)).length;
      rates.push(back / members.length);
    }
    const y = Math.floor(m0 / 12);
    return { label: bucketLabel(`${y}-${String((m0 % 12) + 1).padStart(2, '0')}`), size: members.length, rates };
  });
  const avg = [];
  for (let k = 0; k < offsets; k++) {
    let w = 0;
    let s = 0;
    for (const row of table) if (row.rates[k] != null) {
      s += row.rates[k] * row.size;
      w += row.size;
    }
    avg.push(w ? s / w : null);
  }
  if (avg[0] == null) return { error: 'The data covers only one month, so nobody can have come back yet.' };
  const ever = [...first.keys()].filter((id) => active.get(id).size > 1).length / first.size;
  const k3 = avg[2] != null ? ` After 3 months, ${pct(avg[2])} are still active.` : '';
  const answer = `On average ${pct(avg[0])} of new ${idCol.name} values come back the month after they first appear.${k3} Overall, ${pct(ever)} of all ${first.size.toLocaleString('en-US')} came back at least once.`;
  return {
    answer,
    customer: idCol.name,
    customerOptions: ids.map((c) => c.name),
    table,
    average: avg,
    chart: {
      type: 'bar', xLabel: 'Months later', valueLabel: '% who came back',
      bars: avg.map((v, k) => ({ label: `${k + 1} month${k ? 's' : ''} later`, value: v == null ? 0 : Math.round(v * 1000) / 10 })).filter((_, k) => avg[k] != null),
      total: avg.length,
    },
  };
}

// ---------- 9. funnel ----------

/** Yes/no columns (or numbers that count something) that can be steps. */
export function funnelColumns(ds) {
  return ds.columns.filter((c) => c.type === 'boolean' || (c.type === 'number' && c.values.every((v) => v == null || v >= 0)));
}

/**
 * Yes/no columns that form a funnel: ordered from most to fewest "yes", where (almost) every
 * row that reached a step also reached the one before. Unrelated yes/no columns (rainy,
 * weekend) don't qualify.
 */
export function nestedSteps(ds, indices) {
  const sample = evenSample(indices, 20000);
  const cols = ds.columns.filter((c) => c.type === 'boolean')
    .map((c) => ({ c, rows: sample.filter((i) => c.values[i] === true) }))
    .filter((x) => x.rows.length > 0)
    .sort((a, b) => b.rows.length - a.rows.length);
  const chain = [];
  for (const x of cols) {
    const prev = chain[chain.length - 1];
    if (!prev) {
      chain.push(x);
      continue;
    }
    const inside = x.rows.filter((i) => prev.c.values[i] === true).length;
    if (inside >= x.rows.length * 0.95 && x.rows.length < prev.rows.length) chain.push(x);
  }
  return chain.length >= 2 ? chain.slice(0, 6).map((x) => x.c) : [];
}

const reached = (c, i) => (c.type === 'boolean' ? c.values[i] === true : (c.values[i] ?? 0) > 0);

export function funnel(ds, indices, { steps } = {}) {
  const options = funnelColumns(ds);
  let cols = (steps ?? []).map((n) => options.find((c) => c.name === n)).filter(Boolean);
  if (cols.length < 2) cols = nestedSteps(ds, indices);
  if (cols.length < 2) return { error: 'A funnel needs yes/no columns for steps that follow one another, such as visited → signed up → bought (everyone who bought also signed up).' };
  let rows = indices;
  const start = indices.length;
  const stages = [{ name: 'All rows', count: start }];
  for (const c of cols) {
    rows = rows.filter((i) => reached(c, i));
    stages.push({ name: c.name, count: rows.length });
  }
  stages.forEach((s, k) => {
    s.ofStart = start ? s.count / start : 0;
    s.ofPrevious = k ? (stages[k - 1].count ? s.count / stages[k - 1].count : 0) : 1;
  });
  let worst = 1;
  for (let k = 2; k < stages.length; k++) if (stages[k].ofPrevious < stages[worst].ofPrevious) worst = k;
  const lastStage = stages[stages.length - 1];
  const answer = `Of ${start.toLocaleString('en-US')} rows, ${stages[1].count.toLocaleString('en-US')} reached “${stages[1].name}” (${pct(stages[1].ofStart)}) and ${lastStage.count.toLocaleString('en-US')} made it all the way to “${lastStage.name}” (${pct(lastStage.ofStart)}).` +
    (stages.length > 2 ? ` The biggest drop is from “${stages[worst - 1].name}” to “${stages[worst].name}”: ${pct(1 - stages[worst].ofPrevious)} are lost there.` : '');
  return {
    answer,
    steps: cols.map((c) => c.name),
    stepOptions: options.map((c) => c.name),
    stages,
    chart: { type: 'bar', xLabel: 'Step', valueLabel: 'Rows that got this far', bars: stages.map((s) => ({ label: s.name, value: s.count, note: pct(s.ofStart) })), total: stages.length, keepOrder: true },
  };
}

// ---------- 10. trend vs pattern ----------

export function trendAndPattern(ds, indices, { date, measure = defaultMeasure(ds) } = {}) {
  const dateCol = colByName(ds, date) ?? ds.columns.find((c) => c.type === 'date');
  if (!dateCol) return { error: 'This needs a date column.' };
  const measureCol = measure ? colByName(ds, measure) : null;
  const daily = new Map();
  for (const i of indices) {
    const t = dateCol.values[i];
    if (t == null) continue;
    const k = Math.floor(t / DAY);
    daily.set(k, (daily.get(k) ?? 0) + (measureCol ? measureCol.values[i] ?? 0 : 1));
  }
  const days = [...daily.keys()].sort((a, b) => a - b);
  if (days.length < 14) return { error: `This needs at least two weeks of dates; the data has ${days.length} different days.` };
  const unit = autoUnit(days.map((d) => d * DAY)) === 'day' ? 'day' : 'month';
  const what = measureCol ? measureCol.name : 'the number of rows';

  // Weekly pattern: each weekday's average compared with the overall daily average.
  const byWeekday = Array.from({ length: 7 }, () => []);
  for (const d of days) byWeekday[new Date(d * DAY).getUTCDay()].push(daily.get(d));
  const dayMean = mean(days.map((d) => daily.get(d)));
  const weekly = byWeekday.map((xs, w) => ({ day: WEEKDAYS[w], name: WEEKDAY_NAMES[w], effect: xs.length ? mean(xs) / dayMean - 1 : null }));
  const order = [1, 2, 3, 4, 5, 6, 0].map((w) => weekly[w]).filter((x) => x.effect != null);
  const busiest = [...order].sort((a, b) => b.effect - a.effect)[0];
  const quietest = [...order].sort((a, b) => a.effect - b.effect)[0];
  const weeklyMatters = busiest.effect - quietest.effect > 0.15 && order.length === 7;

  // Trend: the series by month (or week for short data), and the straight-line slope through it.
  const span = days[days.length - 1] - days[0];
  const step = span >= 120 ? 'month' : 'week';
  const buckets = new Map();
  for (const d of days) {
    const t = d * DAY;
    const k = step === 'month' ? dateBucket(t, 'month') : String(Math.floor((d - days[0]) / 7));
    if (!buckets.has(k)) buckets.set(k, { x: t, sum: 0, n: 0 });
    const b = buckets.get(k);
    b.sum += daily.get(d);
    b.n++;
  }
  // Use the average per day in each bucket, so a half-finished last month doesn't look like a fall.
  const pts = [...buckets.values()].map((b) => ({ x: b.x, y: b.sum / b.n }));
  const xs = pts.map((_, k) => k);
  const ys = pts.map((p) => p.y);
  const mx = mean(xs);
  const myy = mean(ys);
  let num = 0;
  let den = 0;
  xs.forEach((x, k) => {
    num += (x - mx) * (ys[k] - myy);
    den += (x - mx) ** 2;
  });
  const slope = den ? num / den : 0;
  const perStep = myy ? slope / myy : 0;
  const trendWord = Math.abs(perStep) < 0.01 ? 'is roughly flat' : `is ${perStep > 0 ? 'rising' : 'falling'} by about ${pct(Math.abs(perStep))} a ${step}`;

  // Yearly pattern (needs two years of data): average per month of the year.
  let yearly = null;
  if (span >= 700) {
    const byMonth = Array.from({ length: 12 }, () => []);
    for (const d of days) byMonth[new Date(d * DAY).getUTCMonth()].push(daily.get(d));
    yearly = byMonth.map((v, m) => ({ month: bucketLabel(`2000-${String(m + 1).padStart(2, '0')}`).slice(0, 3), effect: v.length ? mean(v) / dayMean - 1 : null }));
  }
  let answer = `Overall, ${what} ${trendWord}.`;
  if (weeklyMatters) answer += ` Within each week, ${busiest.name}s are busiest (${busiest.effect > 0 ? '+' : ''}${pct(busiest.effect)} vs an average day) and ${quietest.name}s quietest (${pct(quietest.effect)}).`;
  else answer += ' There is no strong weekly pattern.';
  if (yearly) {
    const ym = yearly.filter((m) => m.effect != null);
    const top = [...ym].sort((a, b) => b.effect - a.effect)[0];
    const low = [...ym].sort((a, b) => a.effect - b.effect)[0];
    if (top.effect - low.effect > 0.15) answer += ` Across the year, ${top.month} is the strongest month and ${low.month} the weakest.`;
  }
  return {
    answer,
    unit,
    trend: { perStep, step },
    weekly: order,
    yearly,
    chart: { type: 'line', xIsDate: true, unit: step === 'month' ? 'month' : 'day', xLabel: dateCol.name, yLabel: `${measureCol ? measureCol.name : 'Rows'} per day (average)`, points: pts },
    patternChart: { type: 'bar', xLabel: 'Day of the week', valueLabel: '% above or below an average day', bars: order.map((w) => ({ label: w.day, value: Math.round(w.effect * 1000) / 10, tone: w.effect >= 0 ? 'up' : 'down' })), total: order.length, keepOrder: true },
  };
}

// ---------- 11. delayed effects ----------

export function delayedEffect(ds, indices, { cause, effect, date } = {}) {
  const dateCol = colByName(ds, date) ?? ds.columns.find((c) => c.type === 'date');
  if (!dateCol) return { error: 'Delayed effects need a date column, to line things up over time.' };
  const nums = measureColumns(ds, indices);
  const effectCol = colByName(ds, effect) ?? colByName(ds, defaultMeasure(ds)) ?? nums[0];
  let causeCol = colByName(ds, cause) && colByName(ds, cause) !== effectCol ? colByName(ds, cause) : null;
  if (!causeCol) {
    // Default cause: the column with the clearest relationship after a delay.
    let best = null;
    for (const c of nums) {
      if (c === effectCol) continue;
      const r = delayedEffect(ds, indices, { cause: c.name, effect: effectCol?.name, date });
      const delayed = r.lags?.filter((l) => l.lag > 0 && l.r != null).sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0];
      if (delayed && (!best || Math.abs(delayed.r) > best.s)) best = { c, s: Math.abs(delayed.r) };
    }
    causeCol = best?.c ?? nums.find((c) => c !== effectCol);
  }
  if (!effectCol || !causeCol) return { error: 'Delayed effects need two number columns: a possible cause and an outcome.' };
  const times = indices.map((i) => dateCol.values[i]).filter((t) => t != null);
  const unit = autoUnit(times) === 'day' || times.length / new Set(times.map((t) => Math.floor(t / DAY))).size < 3 ? 'day' : 'month';
  const keyOf = (t) => (unit === 'day' ? Math.floor(t / DAY) : new Date(t).getUTCFullYear() * 12 + new Date(t).getUTCMonth());
  const agg = new Map();
  for (const i of indices) {
    const t = dateCol.values[i];
    if (t == null) continue;
    const k = keyOf(t);
    if (!agg.has(k)) agg.set(k, { c: [], e: [] });
    const a = agg.get(k);
    if (causeCol.values[i] != null) a.c.push(causeCol.values[i]);
    if (effectCol.values[i] != null) a.e.push(effectCol.values[i]);
  }
  const keys = [...agg.keys()].sort((a, b) => a - b);
  if (keys.length < 12) return { error: `This needs at least 12 different ${unit}s; the data has ${keys.length}.` };
  const c = new Map(keys.map((k) => [k, agg.get(k).c.length ? mean(agg.get(k).c) : null]));
  const e = new Map(keys.map((k) => [k, agg.get(k).e.length ? mean(agg.get(k).e) : null]));
  const maxLag = unit === 'day' ? 7 : 3;
  const lags = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    const xs = [];
    const ys = [];
    for (const k of keys) {
      const x = c.get(k - lag);
      const y = e.get(k);
      if (x != null && y != null) {
        xs.push(x);
        ys.push(y);
      }
    }
    const r = xs.length >= 8 ? pearson(xs, ys) : null;
    lags.push({ lag, r: Number.isFinite(r) ? r : null, n: xs.length });
  }
  const best = lags.filter((l) => l.r != null).sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0];
  if (!best) return { error: 'There are not enough matching dates to compare.' };
  const strength = Math.abs(best.r) >= 0.7 ? 'strongly' : Math.abs(best.r) >= 0.4 ? 'clearly' : Math.abs(best.r) >= 0.2 ? 'weakly' : 'hardly';
  const when = best.lag === 0 ? `on the same ${unit}` : `${best.lag} ${unit}${best.lag > 1 ? 's' : ''} later`;
  const answer = Math.abs(best.r) < 0.2
    ? `${causeCol.name} and ${effectCol.name} hardly move together, with or without a delay.`
    : `${effectCol.name} is ${strength} related to ${causeCol.name} ${when} (r = ${best.r.toFixed(2)}): when ${causeCol.name} is higher, ${effectCol.name} tends to be ${best.r > 0 ? 'higher' : 'lower'} ${best.lag ? when : 'too'}.`;
  return {
    answer,
    caution: 'Moving together, even with a delay, is a clue rather than proof that one causes the other.',
    cause: causeCol.name,
    effect: effectCol.name,
    options: nums.map((x) => x.name),
    unit,
    lags,
    best,
    chart: { type: 'bar', xLabel: 'Delay', valueLabel: 'How closely they move together (r)', bars: lags.filter((l) => l.r != null).map((l) => ({ label: l.lag === 0 ? 'Same ' + unit : `${l.lag} ${unit}${l.lag > 1 ? 's' : ''} later`, value: Math.round(l.r * 100) / 100, tone: l.r >= 0 ? 'up' : 'down' })), total: lags.length, keepOrder: true },
  };
}

export { groupingColumns };
