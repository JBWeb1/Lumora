// Automatic, plain-English findings about a dataset.

import { correlationStrength, describe, frequencies, numbers, pearson } from './stats.js';
import { formatDate, formatNumber } from './transform.js';

const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * Each insight: { kind: 'info' | 'warning' | 'highlight', title, detail, term?, action? }
 * `term` links to a glossary entry; `action` describes a chart that shows the finding.
 * `indices` restricts the analysis to those rows (e.g. after filtering).
 */
export function generateInsights(dataset, indices) {
  const rows = indices ?? [...Array(dataset.rowCount).keys()];
  const n = rows.length;
  const cols = dataset.columns.map((c, index) => ({ ...c, index, values: rows.map((i) => c.values[i]) }));
  const insights = [];
  if (!n) return [{ kind: 'warning', title: 'No rows to analyse', detail: 'Your filters removed every row. Try loosening them.' }];

  // Missing values
  const missing = cols
    .map((c) => ({ c, missing: c.values.filter((v) => v == null).length }))
    .filter((m) => m.missing > 0)
    .sort((a, b) => b.missing - a.missing);
  if (missing.length) {
    const list = missing.slice(0, 4).map((m) => `${m.c.name} (${pct(m.missing / n)})`).join(', ');
    insights.push({
      kind: 'warning',
      title: `${missing.length} column${missing.length > 1 ? 's have' : ' has'} missing values`,
      detail: `Most gaps: ${list}. Averages and charts skip missing values, so check that gaps aren't hiding a pattern.`,
      term: 'missing',
    });
  } else {
    insights.push({ kind: 'info', title: 'No missing values', detail: 'Every cell has a value. Nice, clean data.', term: 'missing' });
  }

  // Exact duplicate rows
  const seen = new Set();
  let duplicates = 0;
  for (const i of rows) {
    const key = dataset.columns.map((c) => c.raw[i]).join('\u0001');
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  if (duplicates) {
    insights.push({
      kind: 'warning',
      title: `${duplicates} duplicate row${duplicates > 1 ? 's' : ''}`,
      detail: 'Some rows are exact copies of earlier rows. If they were recorded twice by mistake, they will inflate counts and totals.',
      term: 'cleaning',
      action: { tab: 'clean', label: 'Fix it →' },
    });
  }

  const numeric = cols.filter((c) => c.type === 'number');

  // Correlations
  const correlations = [];
  for (let a = 0; a < numeric.length; a++) {
    for (let b = a + 1; b < numeric.length; b++) {
      const r = pearson(numeric[a].values, numeric[b].values);
      if (Number.isFinite(r) && Math.abs(r) >= 0.4) correlations.push({ a: numeric[a], b: numeric[b], r });
    }
  }
  correlations.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  for (const { a, b, r } of correlations.slice(0, 3)) {
    const dir = r > 0 ? 'rises' : 'falls';
    insights.push({
      kind: 'highlight',
      title: `${a.name} and ${b.name} move together`,
      detail: `There is a ${correlationStrength(r)} ${r > 0 ? 'positive' : 'negative'} correlation (r = ${r.toFixed(2)}): when ${a.name} goes up, ${b.name} usually ${dir}. Correlation alone doesn't prove one causes the other.`,
      term: 'correlation',
      action: { type: 'scatter', x: a.index, y: b.index },
    });
  }

  // Shape of numeric columns (only the most notable outlier findings, to avoid overwhelming)
  const outlierFindings = [];
  for (const c of numeric) {
    const xs = numbers(c.values);
    if (xs.length < 8) continue;
    const d = describe(xs);
    if (d.min === d.max) continue;
    if (d.outliers > 0 && d.outliers / xs.length <= 0.1) {
      outlierFindings.push({
        share: d.outliers / xs.length,
        kind: 'warning',
        title: `${d.outliers} unusual value${d.outliers > 1 ? 's' : ''} in ${c.name}`,
        detail: `These fall outside the typical range of ${formatNumber(d.lowerFence)} to ${formatNumber(d.upperFence)}. They could be errors or genuinely interesting cases.`,
        term: 'outlier',
        action: { type: 'box', x: c.index },
      });
    }
    if (Math.abs(d.skew) >= 1) {
      insights.push({
        kind: 'info',
        title: `${c.name} is skewed ${d.skew > 0 ? 'right' : 'left'}`,
        detail: `A few ${d.skew > 0 ? 'large' : 'small'} values pull the average (${formatNumber(d.mean)}) away from the middle value (${formatNumber(d.median)}). The median is a better "typical" value here.`,
        term: 'skewness',
        action: { type: 'histogram', x: c.index },
      });
    }
  }

  outlierFindings.sort((x, y) => y.share - x.share);
  for (const { share, ...finding } of outlierFindings.slice(0, 2)) insights.push(finding);

  // Categories
  for (const c of cols.filter((c) => c.type === 'category' || c.type === 'boolean')) {
    const freq = frequencies(c.values);
    const present = c.values.filter((v) => v != null).length;
    if (freq.length === 1 && present === n) {
      insights.push({ kind: 'info', title: `${c.name} has only one value`, detail: `Every row is "${freq[0].value}", so this column can't explain differences between rows.` });
    } else if (freq.length > 1 && present && freq[0].count / present >= 0.8) {
      insights.push({
        kind: 'info',
        title: `${c.name} is mostly "${c.type === 'boolean' ? (freq[0].value ? 'yes' : 'no') : freq[0].value}"`,
        detail: `${pct(freq[0].count / present)} of rows share this value, so comparisons between groups will rest on few rows.`,
        action: { type: 'bar', x: c.index },
      });
    }
  }

  // Biggest group difference: a numeric measure that differs most across categories.
  const cats = cols.filter((c) => (c.type === 'category' || c.type === 'boolean') && new Set(c.values).size <= 12);
  let best = null;
  for (const cat of cats) {
    for (const num of numeric) {
      const groups = new Map();
      cat.values.forEach((g, i) => {
        if (g == null || num.values[i] == null) return;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(num.values[i]);
      });
      const means = [...groups.entries()].filter(([, xs]) => xs.length >= 5).map(([g, xs]) => ({ g, m: xs.reduce((s, x) => s + x, 0) / xs.length }));
      if (means.length < 2) continue;
      const all = describe(numbers(num.values));
      if (!all.std) continue;
      means.sort((x, y) => y.m - x.m);
      const gap = (means[0].m - means[means.length - 1].m) / all.std;
      if (gap >= 0.5 && (!best || gap > best.gap)) best = { cat, num, hi: means[0], lo: means[means.length - 1], gap };
    }
  }
  if (best) {
    const label = (g) => (typeof g === 'boolean' ? (g ? 'yes' : 'no') : g);
    insights.push({
      kind: 'highlight',
      title: `${best.num.name} differs a lot by ${best.cat.name}`,
      detail: `Average ${best.num.name} is ${formatNumber(best.hi.m)} when ${best.cat.name} is "${label(best.hi.g)}" but ${formatNumber(best.lo.m)} when it is "${label(best.lo.g)}".`,
      term: 'groupby',
      action: { type: 'bar', x: best.cat.index, y: best.num.index },
    });
  }

  // Identifier-like and date columns
  for (const c of cols) {
    if (c.type === 'date') {
      const ts = numbers(c.values);
      if (ts.length) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const t of ts) {
          if (t < lo) lo = t;
          if (t > hi) hi = t;
        }
        insights.push({ kind: 'info', title: `${c.name} spans ${formatDate(lo)} to ${formatDate(hi)}`, detail: 'Try a line chart to see how things change over time.', action: { type: 'line', x: c.index } });
      }
    } else if ((c.type === 'text' || c.type === 'number') && n >= 20) {
      const present = c.values.filter((v) => v != null);
      if (present.length === n && new Set(present).size === n && (c.type === 'text' || /(^|[\s_-])(id|code|key|no)$|^id([\s_-]|$)/i.test(c.name))) {
        insights.push({ kind: 'info', title: `${c.name} looks like an ID column`, detail: 'Every value is unique, so it identifies rows rather than measuring something. Averages of it are meaningless.' });
      }
    }
  }

  return insights;
}
