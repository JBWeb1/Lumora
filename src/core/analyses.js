// Goal-first analyses: each answers one plain question ("why did it change?",
// "how do these two groups differ?") with a one-sentence answer, chart data and details.
//
// Every function is pure: (dataset, row indices, settings) → result. Settings refer to
// columns by name, so saved analyses survive renames and reloads. Each result has
// `answer` (one sentence) or `error` (a plain explanation of what's missing).

import { frequencies, mean, median, numbers } from './stats.js';
import { dateBucket, formatDate, formatNumber } from './transform.js';
import { welchTTest } from './significance.js';

// ---------- shared helpers ----------

export const colByName = (ds, name) => ds.columns.find((c) => c.name === name) ?? null;
const isCategorical = (c) => c.type === 'category' || c.type === 'boolean';
const pct = (x) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;
const signed = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${formatNumber(Math.abs(x))}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86_400_000;

/** Pick day, month or year buckets so a date column gives a readable number of periods. */
export function autoUnit(times) {
  if (!times.length) return 'month';
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of times) {
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  const days = (hi - lo) / DAY;
  if (days >= 3 * 365) return 'year';
  if (days >= 90) return 'month';
  return 'day';
}

/** "2024-03" → "Mar 2024", "2024-03-05" → "Mar 5, 2024", "2024" → "2024". */
export function bucketLabel(key) {
  let m;
  if ((m = /^(\d{4})-(\d{2})$/.exec(key))) return `${MONTHS[+m[2] - 1]} ${m[1]}`;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key))) return formatDate(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return key;
}

/** The value of a measure for a set of rows: a sum of a number column, or a row count. */
function total(rows, measure) {
  if (!measure) return rows.length;
  let s = 0;
  for (const i of rows) {
    const v = measure.values[i];
    if (v != null) s += v;
  }
  return s;
}

function measureLabel(measure) {
  return measure ? measure.name : 'Number of rows';
}

/** Columns that can be used to split rows into groups (2 to 60 distinct values). */
export function groupingColumns(ds, indices, exclude = []) {
  return ds.columns.filter((c) => {
    if (exclude.includes(c.name) || !(isCategorical(c) || c.type === 'text')) return false;
    const distinct = new Set();
    for (const i of indices) {
      const v = c.values[i];
      if (v != null) distinct.add(v);
      if (distinct.size > 60) return false;
    }
    return distinct.size >= 2;
  });
}

// Most likely "how much" columns first: money, then other values, then counts.
const MEASURE_WORDS = [/revenue|sales|turnover|income|profit|amount|spend|spent|total/i, /cost|price|value|budget|fee/i, /orders?|quantity|qty|units|customers|visitors|visits|score|count/i];

/**
 * The number column people most likely mean by "how much" (revenue, sales, amount…), or
 * undefined to count rows. Row numbers and IDs are never chosen.
 */
export function defaultMeasure(ds) {
  const nums = ds.columns.filter((c) => c.type === 'number' && !/(^|[\s_])(id|no|number|code|index|year|month|day|lat|lon|latitude|longitude)$/i.test(c.name.trim()));
  for (const words of MEASURE_WORDS) {
    const hit = nums.find((c) => words.test(c.name));
    if (hit) return hit.name;
  }
  return nums.find((c) => c.values.some((v) => v != null && v !== 0))?.name;
}

/** Choose the grouping column for comparisons: yes/no columns first, then the fewest categories. */
function preferredSplit(options, indices) {
  const distinct = (c) => new Set(indices.slice(0, 5000).map((i) => c.values[i]).filter((v) => v != null)).size;
  return [...options].sort((a, b) => (b.type === 'boolean') - (a.type === 'boolean') || distinct(a) - distinct(b))[0];
}

const keyOf = (c, v) => (v == null ? '(missing)' : c.type === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

// ---------- 1. why did it change? ----------

/** Break the change between two periods down by the categories of one column. */
function contributions(rows0, rows1, by, measure) {
  const groups = new Map();
  const add = (rows, slot) => {
    for (const i of rows) {
      const k = keyOf(by, by.values[i]);
      if (!groups.has(k)) groups.set(k, [0, 0]);
      groups.get(k)[slot] += measure ? measure.values[i] ?? 0 : 1;
    }
  };
  add(rows0, 0);
  add(rows1, 1);
  return [...groups.entries()]
    .map(([label, [before, after]]) => ({ label, before, after, change: after - before }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

/** How much of the change the top few categories explain (0..1): high means one clear cause. */
function concentration(parts) {
  const totalAbs = parts.reduce((s, p) => s + Math.abs(p.change), 0);
  if (!totalAbs) return 0;
  // Columns with very many categories always look "concentrated" in a few of them; discount them a little.
  return parts.slice(0, 3).reduce((s, p) => s + Math.abs(p.change), 0) / totalAbs - (parts.length > 15 ? 0.1 : 0);
}

export function explainChange(ds, indices, { date, measure = defaultMeasure(ds), by, from, to, unit } = {}) {
  const dateCol = colByName(ds, date) ?? ds.columns.find((c) => c.type === 'date');
  if (!dateCol) return { error: 'This needs a date column, to compare one period with another.' };
  const measureCol = measure ? colByName(ds, measure) : null;
  const times = [];
  for (const i of indices) if (dateCol.values[i] != null) times.push(dateCol.values[i]);
  const u = unit ?? autoUnit(times);
  const byPeriod = new Map();
  for (const i of indices) {
    const t = dateCol.values[i];
    if (t == null) continue;
    const k = dateBucket(t, u);
    if (!byPeriod.has(k)) byPeriod.set(k, []);
    byPeriod.get(k).push(i);
  }
  const periods = [...byPeriod.keys()].sort();
  if (periods.length < 2) return { error: `There is only one ${u} in the data, so there is nothing to compare.` };
  const p1 = periods.includes(to) ? to : periods[periods.length - 1];
  const p0 = periods.includes(from) && from !== p1 ? from : periods[Math.max(0, periods.indexOf(p1) - 1)];
  const rows0 = byPeriod.get(p0);
  const rows1 = byPeriod.get(p1);
  const before = total(rows0, measureCol);
  const after = total(rows1, measureCol);
  const change = after - before;

  // Rank every grouping column by how clearly a few of its categories explain the change.
  const candidates = groupingColumns(ds, [...rows0, ...rows1], [dateCol.name, measureCol?.name]).map((c) => {
    const parts = contributions(rows0, rows1, c, measureCol);
    return { column: c.name, parts, score: concentration(parts) };
  }).sort((a, b) => b.score - a.score);
  const chosen = candidates.find((c) => c.column === by) ?? candidates[0] ?? null;

  // A period that has only just started looks like a fall; say so.
  let partial = null;
  if (u === 'month' || u === 'year') {
    let last = -Infinity;
    for (const i of rows1) last = Math.max(last, dateCol.values[i]);
    const d = new Date(last);
    if (u === 'month' && d.getUTCDate() < 25 && p1 === periods[periods.length - 1]) partial = `${bucketLabel(p1)} may not be complete yet (the data stops on ${formatDate(last)}).`;
    if (u === 'year' && d.getUTCMonth() < 11 && p1 === periods[periods.length - 1]) partial = `${p1} may not be complete yet (the data stops on ${formatDate(last)}).`;
  }

  const what = measureCol ? `Total ${measureCol.name}` : 'The number of rows';
  const direction = change > 0 ? 'rose' : change < 0 ? 'fell' : 'stayed the same';
  let answer = `${what} ${direction} from ${formatNumber(before)} in ${bucketLabel(p0)} to ${formatNumber(after)} in ${bucketLabel(p1)}${before ? ` (${pct(change / Math.abs(before))})` : ''}.`;
  let parts = [];
  if (chosen && change !== 0) {
    parts = chosen.parts;
    const drivers = parts.filter((p) => Math.sign(p.change) === Math.sign(change)).slice(0, 2);
    if (drivers.length) {
      const share = drivers.reduce((s, p) => s + p.change, 0) / change;
      answer += ` Most of that came from ${chosen.column} ${drivers.map((p) => `“${p.label}” (${signed(p.change)})`).join(' and ')}${share > 0 && share <= 1 ? `, ${Math.round(share * 100)}% of the change` : ''}.`;
    }
    const against = parts.find((p) => Math.sign(p.change) === -Math.sign(change) && Math.abs(p.change) > Math.abs(change) * 0.1);
    if (against) answer += ` “${against.label}” moved the other way (${signed(against.change)}).`;
  }
  const shown = parts.slice(0, 12);
  const rest = parts.slice(12);
  const restChange = rest.reduce((s, p) => s + p.change, 0);
  return {
    answer,
    partial,
    unit: u,
    periods: periods.map((k) => ({ value: k, label: bucketLabel(k) })),
    from: p0,
    to: p1,
    before,
    after,
    change,
    by: chosen?.column ?? null,
    byOptions: candidates.map((c) => c.column),
    measureLabel: measureLabel(measureCol),
    parts,
    chart: shown.length ? {
      type: 'bar',
      xLabel: chosen.column,
      valueLabel: `Change in ${measureLabel(measureCol).toLowerCase() === 'number of rows' ? 'rows' : measureCol.name}`,
      bars: [...shown.map((p) => ({ label: p.label, value: p.change, tone: p.change >= 0 ? 'up' : 'down' })),
        ...(rest.length ? [{ label: `${rest.length} others`, value: restChange, tone: restChange >= 0 ? 'up' : 'down' }] : [])],
      total: shown.length,
    } : null,
  };
}

// ---------- 2. compare two groups ----------

function effectWord(d) {
  const a = Math.abs(d);
  if (a >= 0.8) return 'a big difference';
  if (a >= 0.5) return 'a clear difference';
  if (a >= 0.2) return 'a small difference';
  return 'about the same';
}

function likelyReal(p) {
  if (p == null) return 'not enough data to tell';
  if (p < 0.001) return 'almost certainly real';
  if (p < 0.05) return 'likely real';
  if (p < 0.2) return 'could be luck';
  return 'probably just luck';
}

export function compareGroups(ds, indices, { column, a, b } = {}) {
  const options = groupingColumns(ds, indices);
  const col = colByName(ds, column) && options.some((c) => c.name === column) ? colByName(ds, column) : preferredSplit(options, indices);
  if (!col) return { error: 'This needs a column that splits rows into groups, such as a category or yes/no column.' };
  const counts = frequencies(indices.map((i) => keyOf(col, col.values[i])).filter((k) => k !== '(missing)'));
  const values = counts.map((f) => f.value);
  const ga = values.includes(a) ? a : values[0];
  const gb = values.includes(b) && b !== ga ? b : values.find((v) => v !== ga);
  const rowsA = indices.filter((i) => keyOf(col, col.values[i]) === ga);
  const rowsB = indices.filter((i) => keyOf(col, col.values[i]) === gb);

  const rows = ds.columns.filter((c) => c.type === 'number').map((c) => {
    const xa = numbers(rowsA.map((i) => c.values[i]));
    const xb = numbers(rowsB.map((i) => c.values[i]));
    if (xa.length < 2 || xb.length < 2) return null;
    const ma = mean(xa);
    const mb = mean(xb);
    const sd = Math.sqrt(((xa.length - 1) * variance(xa) + (xb.length - 1) * variance(xb)) / (xa.length + xb.length - 2));
    const d = sd ? (ma - mb) / sd : 0;
    const test = welchTTest(xa, xb);
    return { column: c.name, a: ma, b: mb, diff: ma - mb, pct: mb ? (ma - mb) / Math.abs(mb) : null, d, p: test?.p ?? null, effect: effectWord(d), verdict: likelyReal(test?.p) };
  }).filter(Boolean).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));

  let answer;
  const top = rows.find((r) => r.p != null && r.p < 0.05 && Math.abs(r.d) >= 0.2);
  if (!rows.length) answer = `“${ga}” has ${rowsA.length.toLocaleString('en-US')} rows and “${gb}” has ${rowsB.length.toLocaleString('en-US')}. There are no number columns to compare.`;
  else if (top) {
    answer = `The biggest difference between “${ga}” and “${gb}” is ${top.column}: ${formatNumber(top.a)} vs ${formatNumber(top.b)} on average${top.pct != null ? ` (${pct(top.pct)})` : ''}, which is ${top.verdict}.`;
    const others = rows.filter((r) => r !== top && r.p != null && r.p < 0.05 && Math.abs(r.d) >= 0.2).slice(0, 2);
    if (others.length) answer += ` They also differ in ${others.map((r) => r.column).join(' and ')}.`;
  } else answer = `“${ga}” and “${gb}” look much the same: no number column differs by more than could be luck.`;
  const small = Math.min(rowsA.length, rowsB.length) < 10;
  return {
    answer,
    warning: small ? `One group has fewer than 10 rows, so treat these differences with caution.` : null,
    column: col.name,
    columnOptions: options.map((c) => c.name),
    groups: values,
    a: ga,
    b: gb,
    sizes: [rowsA.length, rowsB.length],
    rows,
    chart: rows.length ? {
      type: 'bar',
      xLabel: 'Column',
      valueLabel: `Difference, “${ga}” compared with “${gb}” (%)`,
      bars: rows.filter((r) => r.pct != null).slice(0, 12).map((r) => ({ label: r.column, value: Math.round(r.pct * 1000) / 10, tone: r.pct >= 0 ? 'up' : 'down' })),
      total: rows.length,
    } : null,
  };
}

function variance(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / (xs.length - 1);
}

// ---------- 3. unusual days (or months) ----------

/** A series of totals per period. */
function series(ds, indices, dateCol, measureCol, unit) {
  const sums = new Map();
  for (const i of indices) {
    const t = dateCol.values[i];
    if (t == null) continue;
    const k = dateBucket(t, unit);
    sums.set(k, (sums.get(k) ?? 0) + (measureCol ? measureCol.values[i] ?? 0 : 1));
  }
  return [...sums.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([k, y]) => ({ key: k, x: keyToTime(k), y }));
}

const keyToTime = (k) => {
  const [y, m = 1, d = 1] = k.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export function unusualPoints(ds, indices, { date, measure = defaultMeasure(ds), unit } = {}) {
  const dateCol = colByName(ds, date) ?? ds.columns.find((c) => c.type === 'date');
  if (!dateCol) return { error: 'This needs a date column, to look for unusual days or months.' };
  const measureCol = measure ? colByName(ds, measure) : null;
  // Days, unless there are too many of them (then months).
  const days = new Set();
  for (const i of indices) if (dateCol.values[i] != null) days.add(Math.floor(dateCol.values[i] / DAY));
  const u = unit ?? (days.size >= 28 && days.size <= 2000 ? 'day' : 'month');
  const pts = series(ds, indices, dateCol, measureCol, u);
  if (pts.length < 10) return { error: `Spotting unusual ${u}s needs at least 10 of them; this data has ${pts.length}.` };

  // Expected value: the median of comparable neighbours. For days, the same weekday in the
  // surrounding weeks (so a normal busy Saturday isn't "unusual"); otherwise nearby periods.
  const weekly = u === 'day' && pts.length >= 28;
  const expected = pts.map((p, k) => {
    const near = [];
    if (weekly) {
      for (let j = 0; j < pts.length; j++) {
        if (j === k) continue;
        const gap = Math.round((pts[j].x - p.x) / DAY);
        if (gap % 7 === 0 && Math.abs(gap) <= 35) near.push(pts[j].y);
      }
    } else {
      for (let j = Math.max(0, k - 3); j <= Math.min(pts.length - 1, k + 3); j++) if (j !== k) near.push(pts[j].y);
    }
    return near.length ? median(near) : p.y;
  });
  const resid = pts.map((p, k) => p.y - expected[k]);
  const absDev = resid.map((r) => Math.abs(r - median(resid)));
  const spread = 1.4826 * median(absDev) || (mean(absDev) * 1.25) || 1;
  const flagged = pts.map((p, k) => ({ ...p, label: bucketLabel(p.key), expected: expected[k], score: resid[k] / spread }))
    .filter((p) => Math.abs(p.score) >= 3.5)
    .sort((x, y) => Math.abs(y.score) - Math.abs(x.score));

  const what = measureCol ? measureCol.name : 'rows';
  const typical = weekly ? 'for that day of the week' : 'for that time';
  let answer;
  if (!flagged.length) answer = `No ${u} stands out: every ${u}'s ${what} is within the normal range ${typical}.`;
  else {
    const top = flagged[0];
    const times2 = top.expected ? top.y / top.expected : null;
    answer = `${flagged.length} ${u}${flagged.length > 1 ? 's' : ''} stand${flagged.length > 1 ? '' : 's'} out. The most unusual is ${top.label}: ${formatNumber(top.y)} ${what} when about ${formatNumber(top.expected)} was normal ${typical}${times2 && times2 > 1.5 ? ` (${times2.toFixed(1)}×)` : times2 != null && times2 < 0.67 ? ` (${Math.round((1 - times2) * 100)}% lower)` : ''}.`;
  }
  return {
    answer,
    unit: u,
    flagged,
    chart: {
      type: 'line', xIsDate: true, unit: u, xLabel: dateCol.name, yLabel: measureCol ? `Total ${measureCol.name}` : 'Rows',
      points: pts.map((p) => ({ x: p.x, y: p.y })),
      highlights: flagged.slice(0, 20).map((p) => ({ x: p.x, y: p.y, label: `${p.label}: ${formatNumber(p.y)} (normal ≈ ${formatNumber(p.expected)})` })),
    },
  };
}

// ---------- 4. top causes (Pareto) ----------

export function topContributors(ds, indices, { by, measure = defaultMeasure(ds) } = {}) {
  const grouping = groupingColumns(ds, indices);
  const options = grouping.concat(ds.columns.filter((c) => c.type === 'text' && !grouping.includes(c)));
  // Rank the things with the most different values (products, customers) rather than yes/no columns.
  const distinct = (c) => new Set(indices.slice(0, 5000).map((i) => c.values[i]).filter((v) => v != null)).size;
  const byCol = colByName(ds, by) ?? [...options].filter((c) => c.type !== 'boolean').sort((a, b) => distinct(b) - distinct(a))[0] ?? options[0] ?? null;
  if (!byCol) return { error: 'This needs a column of categories, such as product, customer or region.' };
  const measureCol = measure ? colByName(ds, measure) : null;
  const sums = new Map();
  for (const i of indices) {
    const v = byCol.values[i];
    if (v == null) continue;
    const k = keyOf(byCol, v);
    sums.set(k, (sums.get(k) ?? 0) + (measureCol ? measureCol.values[i] ?? 0 : 1));
  }
  const items = [...sums.entries()].map(([label, value]) => ({ label, value })).filter((x) => x.value > 0).sort((x, y) => y.value - x.value);
  const all = items.reduce((s, x) => s + x.value, 0);
  if (!items.length || !all) return { error: `There are no positive ${measureCol ? measureCol.name : 'rows'} to add up.` };
  let running = 0;
  for (const it of items) {
    running += it.value;
    it.share = it.value / all;
    it.cumulative = running / all;
  }
  const n80 = items.findIndex((x) => x.cumulative >= 0.8) + 1;
  const what = measureCol ? `of all ${measureCol.name}` : 'of all rows';
  const answer = items.length < 3
    ? `“${items[0].label}” accounts for ${Math.round(items[0].share * 100)}% ${what}.`
    : `${n80} of ${items.length} ${byCol.name} values (${Math.round((n80 / items.length) * 100)}%) make up 80% ${what}. The top one, “${items[0].label}”, is ${Math.round(items[0].share * 100)}% on its own.`;
  return {
    answer,
    by: byCol.name,
    byOptions: options.map((c) => c.name),
    items,
    n80,
    chart: {
      type: 'bar', xLabel: byCol.name, valueLabel: measureCol ? `Total ${measureCol.name}` : 'Rows',
      bars: items.slice(0, 15).map((x, k) => ({ label: x.label, value: x.value, note: `${Math.round(x.cumulative * 100)}% so far`, tone: k < n80 ? 'up' : 'muted' })),
      total: items.length,
    },
  };
}

// ---------- 5. themes in written answers ----------

const STOP = new Set(`a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves also just get got really will one would like much many lot lots even still well make made thing things way bit quite`.split(/\s+/));

const POSITIVE = new Set('good great excellent amazing awesome love loved lovely nice friendly helpful fast quick easy clean fresh tasty delicious perfect happy pleased recommend wonderful fantastic best brilliant comfortable reliable kind polite efficient enjoyed enjoy fun beautiful smooth convenient affordable cheap fair satisfied impressive welcoming warm professional quality'.split(' '));
const NEGATIVE = new Set('bad poor terrible awful horrible slow rude dirty cold expensive overpriced broken late wrong hate hated disappointed disappointing worst difficult hard confusing noisy crowded unfriendly unhelpful bland stale long waiting wait problem problems issue issues complaint missing never mess messy annoying buggy crash crashed small tiny unclear useless'.split(' '));
// Words that only express a feeling ("great", "awful"), not a topic like "wait" or "price".
const TONE_ONLY = new Set('good great excellent amazing awesome love loved lovely nice perfect wonderful fantastic best brilliant bad poor terrible awful horrible worst hate hated disappointing disappointed happy pleased satisfied'.split(' '));
const NEGATORS = new Set(['not', 'no', 'never', "n't", 'hardly', 'barely', "don't", "didn't", "wasn't", "isn't", "aren't", "won't", "couldn't"]);

const words = (s) => String(s).toLowerCase().replace(/[’']/g, "'").match(/[\p{L}\p{N}']+/gu) ?? [];

/** Tone of one answer: +1, -1 or 0, with simple negation ("not good" counts as negative). */
export function answerTone(text) {
  const ws = words(text);
  let score = 0;
  ws.forEach((w, k) => {
    const flip = NEGATORS.has(ws[k - 1]) || NEGATORS.has(ws[k - 2]) ? -1 : 1;
    if (POSITIVE.has(w)) score += flip;
    else if (NEGATIVE.has(w)) score -= flip;
  });
  return Math.sign(score);
}

export function textThemes(ds, indices, { column } = {}) {
  const options = ds.columns.filter((c) => c.type === 'text' || (c.type === 'category' && c.values.some((v) => typeof v === 'string' && v.split(/\s+/).length >= 3)));
  const col = colByName(ds, column) ?? options[0];
  if (!col) return { error: 'This needs a column of written answers, such as comments or feedback.' };
  const answers = indices.map((i) => col.values[i]).filter((v) => v != null && String(v).trim());
  if (answers.length < 3) return { error: `${col.name} has only ${answers.length} written answer${answers.length === 1 ? '' : 's'}; themes need at least 3.` };

  const termAnswers = new Map(); // term → set of answer numbers
  const note = (term, k) => {
    if (!termAnswers.has(term)) termAnswers.set(term, new Set());
    termAnswers.get(term).add(k);
  };
  answers.forEach((a, k) => {
    const ws = words(a).filter((w) => w.length > 1 && !/^\d+$/.test(w));
    const content = ws.filter((w) => !STOP.has(w) && w.length > 2);
    for (const w of new Set(content)) note(stem(w), k);
    for (let j = 0; j + 1 < ws.length; j++) {
      if (STOP.has(ws[j]) || STOP.has(ws[j + 1]) || ws[j].length < 3 || ws[j + 1].length < 3) continue;
      note(`${ws[j]} ${ws[j + 1]}`, k);
    }
  });
  const minCount = answers.length >= 20 ? 3 : 2;
  const display = new Map(); // stem → most common surface word
  for (const a of answers) for (const w of words(a)) if (!STOP.has(w) && w.length > 2) {
    const s = stem(w);
    const d = display.get(s) ?? new Map();
    d.set(w, (d.get(w) ?? 0) + 1);
    display.set(s, d);
  }
  const shown = (term) => (term.includes(' ') ? term : [...(display.get(term)?.entries() ?? [[term, 1]])].sort((x, y) => y[1] - x[1])[0][0]);
  let themes = [...termAnswers.entries()]
    .filter(([, set]) => set.size >= minCount)
    .map(([term, set]) => ({ term: shown(term), count: set.size, share: set.size / answers.length, examples: [...set].slice(0, 3).map((k) => answers[k]), phrase: term.includes(' ') }))
    .sort((x, y) => y.count - x.count || y.phrase - x.phrase);
  // A phrase that covers nearly the same answers as one of its words replaces that word.
  themes = themes.filter((t) => t.phrase || !themes.some((p) => p.phrase && p.term.split(' ').includes(t.term) && p.count >= t.count * 0.8));
  // Words like "great" or "slow" on their own describe tone, not a topic (the tone is shown separately).
  themes = themes.filter((t) => t.phrase || !TONE_ONLY.has(t.term)).slice(0, 15);

  const tones = answers.map(answerTone);
  const pos = tones.filter((t) => t > 0).length;
  const neg = tones.filter((t) => t < 0).length;
  const toneText = pos + neg === 0 ? 'Most answers are neutral in tone.' : `${Math.round((pos / answers.length) * 100)}% sound positive and ${Math.round((neg / answers.length) * 100)}% negative.`;
  const answer = themes.length
    ? `Across ${answers.length.toLocaleString('en-US')} answers in ${col.name}, the most mentioned ${themes.length > 1 ? 'themes are' : 'theme is'} ${themes.slice(0, 3).map((t) => `“${t.term}” (${Math.round(t.share * 100)}%)`).join(', ')}. ${toneText}`
    : `The ${answers.length} answers in ${col.name} don't share common words yet. ${toneText}`;
  return {
    answer,
    column: col.name,
    columnOptions: options.map((c) => c.name),
    themes,
    tone: { positive: pos, negative: neg, neutral: answers.length - pos - neg, total: answers.length,
      positiveExamples: answers.filter((_, k) => tones[k] > 0).slice(0, 3), negativeExamples: answers.filter((_, k) => tones[k] < 0).slice(0, 3) },
    chart: themes.length ? { type: 'bar', xLabel: 'Theme', valueLabel: 'Answers mentioning it', bars: themes.map((t) => ({ label: t.term, value: t.count })), total: themes.length } : null,
  };
}

/** A light English stemmer, so "price", "prices" and "pricing" count together. */
export function stem(w) {
  if (w.length <= 4) return w;
  return w.replace(/(ingly|edly|ing|ed|ies|es|s|ly)$/u, (m) => (m === 'ies' ? 'y' : ''))
    .replace(/(.)\1$/u, '$1')
    .replace(/e$/u, '') || w;
}
