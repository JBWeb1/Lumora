// "Is this real or just luck?": classic significance tests, explained in plain English.

import { groupKey } from './transform.js';
import { isNum, mean, pairs, pearson, variance } from './stats.js';

// ---------- special functions ----------

const LANCZOS = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

export function logGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const TINY = 1e-300;

function betaContinuedFraction(a, b, x) {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-15) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
export function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaContinuedFraction(a, b, x)) / a : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Regularized lower incomplete gamma function P(a, x). */
export function gammaP(a, x) {
  if (x <= 0) return 0;
  const lead = -x + a * Math.log(x) - logGamma(a);
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 1000; n++) {
      ap++;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(lead);
  }
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return 1 - Math.exp(lead) * h;
}

/** Two-sided p-value for a t statistic. */
export const tPValue = (t, df) => incompleteBeta(df / (df + t * t), df / 2, 0.5);
/** Upper-tail p-value for an F statistic. */
export const fPValue = (f, d1, d2) => (f <= 0 ? 1 : incompleteBeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2));
/** Upper-tail p-value for a chi-square statistic. */
export const chiSquarePValue = (x, k) => (x <= 0 ? 1 : 1 - gammaP(k / 2, x / 2));

/** t value with the given two-sided tail probability (e.g. 0.05 → 1.96 for large df). */
export function tCritical(df, alpha = 0.05) {
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (tPValue(mid, df) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------- tests ----------

/** Welch's t-test: do two groups have different averages? */
export function welchTTest(a, b) {
  const na = a.length;
  const nb = b.length;
  if (na < 2 || nb < 2) return null;
  const ma = mean(a);
  const mb = mean(b);
  const va = variance(a);
  const vb = variance(b);
  const se2 = va / na + vb / nb;
  const diff = ma - mb;
  if (se2 === 0) return { t: diff === 0 ? 0 : Infinity, df: na + nb - 2, p: diff === 0 ? 1 : 0, diff, ci: [diff, diff], d: diff === 0 ? 0 : Infinity, meanA: ma, meanB: mb };
  const t = diff / Math.sqrt(se2);
  const df = se2 ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  const margin = tCritical(df) * Math.sqrt(se2);
  const pooled = Math.sqrt((va + vb) / 2);
  return { t, df, p: tPValue(t, df), diff, ci: [diff - margin, diff + margin], d: pooled ? diff / pooled : 0, meanA: ma, meanB: mb };
}

/** One-way ANOVA: do several groups have different averages? */
export function oneWayAnova(groups) {
  const gs = groups.filter((g) => g.length >= 2);
  const k = gs.length;
  const n = gs.reduce((s, g) => s + g.length, 0);
  if (k < 2 || n - k < 1) return null;
  const grand = gs.reduce((s, g) => s + g.reduce((x, y) => x + y, 0), 0) / n;
  let ssb = 0;
  let ssw = 0;
  for (const g of gs) {
    const m = mean(g);
    ssb += g.length * (m - grand) ** 2;
    for (const x of g) ssw += (x - m) ** 2;
  }
  const df1 = k - 1;
  const df2 = n - k;
  if (ssw === 0) return { f: ssb === 0 ? 0 : Infinity, df1, df2, p: ssb === 0 ? 1 : 0, eta2: ssb === 0 ? 0 : 1 };
  const f = ssb / df1 / (ssw / df2);
  return { f, df1, df2, p: fPValue(f, df1, df2), eta2: ssb / (ssb + ssw) };
}

/** Is a correlation stronger than you'd expect by chance? */
export function correlationTest(xValues, yValues) {
  const { xs, ys } = pairs(xValues, yValues);
  const n = xs.length;
  const r = pearson(xs, ys);
  if (n < 4 || !Number.isFinite(r)) return null;
  if (Math.abs(r) >= 1) return { r, n, t: Infinity, p: 0 };
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  return { r, n, t, p: tPValue(t, n - 2) };
}

/** Chi-square test of independence: are two categorical columns related? */
export function chiSquareTest(aValues, bValues) {
  const rows = new Map();
  const colKeys = new Map();
  let n = 0;
  for (let i = 0; i < aValues.length; i++) {
    const a = aValues[i];
    const b = bValues[i];
    if (a == null || b == null) continue;
    if (!rows.has(a)) rows.set(a, new Map());
    rows.get(a).set(b, (rows.get(a).get(b) || 0) + 1);
    colKeys.set(b, (colKeys.get(b) || 0) + 1);
    n++;
  }
  const r = rows.size;
  const c = colKeys.size;
  if (r < 2 || c < 2 || r > 30 || c > 30) return null;
  let chi2 = 0;
  let lowExpected = 0;
  for (const [, row] of rows) {
    const rowTotal = [...row.values()].reduce((s, x) => s + x, 0);
    for (const [key, colTotal] of colKeys) {
      const expected = (rowTotal * colTotal) / n;
      if (expected < 5) lowExpected++;
      chi2 += ((row.get(key) || 0) - expected) ** 2 / expected;
    }
  }
  const df = (r - 1) * (c - 1);
  return { chi2, df, p: chiSquarePValue(chi2, df), n, cramersV: Math.sqrt(chi2 / (n * (Math.min(r, c) - 1))), lowExpectedShare: lowExpected / (r * c) };
}

// ---------- plain-English verdicts ----------

export function formatP(p) {
  if (!Number.isFinite(p)) return 'p = –';
  if (p < 0.001) return 'p < 0.001';
  return `p = ${p < 0.01 ? p.toFixed(3) : p.toFixed(2)}`;
}

/** How convincing is the evidence? */
export function evidence(p) {
  if (p < 0.001) return { level: 'strong', text: 'Very unlikely to be a fluke' };
  if (p < 0.01) return { level: 'strong', text: 'Unlikely to be a fluke' };
  if (p < 0.05) return { level: 'moderate', text: 'Probably real, but the evidence is modest' };
  if (p < 0.1) return { level: 'weak', text: 'Inconclusive: it could easily be chance' };
  return { level: 'none', text: 'No convincing evidence; this could just be chance' };
}

const sizeWord = (x, small, medium, large) => (x >= large ? 'large' : x >= medium ? 'medium-sized' : x >= small ? 'small' : 'tiny');
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2));
const label = (v) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));

/**
 * Pick and run the right test for two columns.
 * Returns { test, term, p, verdict, headline, details[], caution? } or null when no test applies.
 */
export function testColumns(dataset, indices, xIndex, yIndex) {
  if (xIndex == null || yIndex == null || xIndex === yIndex) return null;
  let a = dataset.columns[xIndex];
  let b = dataset.columns[yIndex];
  const grouping = (c) => c.type === 'category' || c.type === 'boolean';
  const av = indices.map((i) => a.values[i]);
  const bv = indices.map((i) => b.values[i]);

  if (a.type === 'number' && b.type === 'number') {
    const res = correlationTest(av, bv);
    if (!res) return null;
    const ev = evidence(res.p);
    return {
      test: 'Correlation test', term: 'pvalue', p: res.p, verdict: ev,
      headline: `${ev.text} (${formatP(res.p)}).`,
      details: [
        `r = ${res.r.toFixed(2)} across ${res.n} rows: a ${sizeWord(Math.abs(res.r), 0.1, 0.3, 0.5)} relationship.`,
        `If there were truly no relationship, a correlation this strong would show up by chance ${res.p < 0.001 ? 'less than 0.1%' : `about ${Math.round(res.p * 100)}%`} of the time.`,
      ],
      caution: 'Even a real correlation does not prove that one thing causes the other.',
    };
  }

  // Put the grouping column first.
  let gv = av;
  let nv = bv;
  if (a.type === 'number' && grouping(b)) {
    [a, b] = [b, a];
    [gv, nv] = [bv, av];
  }

  if (grouping(a) && b.type === 'number') {
    const groups = new Map();
    gv.forEach((g, k) => {
      if (g == null || !isNum(nv[k])) return;
      const key = groupKey(a, g);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(nv[k]);
    });
    const usable = [...groups.entries()].filter(([, xs]) => xs.length >= 2);
    if (usable.length < 2 || usable.length > 30) return null;
    if (usable.length === 2) {
      const [[ga, xa], [gb, xb]] = usable;
      const res = welchTTest(xa, xb);
      if (!res) return null;
      const ev = evidence(res.p);
      const higher = res.diff >= 0 ? ga : gb;
      return {
        test: "Welch's t-test", term: 'ttest', p: res.p, verdict: ev,
        headline: `${ev.text} (${formatP(res.p)}).`,
        details: [
          `Average ${b.name}: ${fmt(res.meanA)} for "${label(ga)}" vs ${fmt(res.meanB)} for "${label(gb)}". "${label(higher)}" is higher by ${fmt(Math.abs(res.diff))}.`,
          `95% confidence interval for the difference: ${fmt(res.ci[0])} to ${fmt(res.ci[1])}${res.ci[0] <= 0 && res.ci[1] >= 0 ? ', which includes zero (no difference)' : ''}.`,
          `Effect size: a ${sizeWord(Math.abs(res.d), 0.2, 0.5, 0.8)} difference (Cohen's d = ${Math.abs(res.d).toFixed(2)}).`,
        ],
        caution: xa.length < 10 || xb.length < 10 ? 'One of the groups is small, so treat this result with care.' : null,
      };
    }
    const res = oneWayAnova(usable.map(([, xs]) => xs));
    if (!res) return null;
    const ev = evidence(res.p);
    const means = usable.map(([g, xs]) => ({ g, m: mean(xs) })).sort((x, y) => y.m - x.m);
    return {
      test: 'One-way ANOVA', term: 'anova', p: res.p, verdict: ev,
      headline: `${ev.text} (${formatP(res.p)}).`,
      details: [
        `Compared the average ${b.name} across ${usable.length} groups of ${a.name}: highest "${label(means[0].g)}" (${fmt(means[0].m)}), lowest "${label(means[means.length - 1].g)}" (${fmt(means[means.length - 1].m)}).`,
        `${a.name} explains ${(res.eta2 * 100).toFixed(1)}% of the variation in ${b.name} (η² = ${res.eta2.toFixed(3)}): a ${sizeWord(res.eta2, 0.01, 0.06, 0.14)} effect.`,
      ],
      caution: 'ANOVA tells you the groups differ somewhere, not which pairs differ. Filter to two groups to compare them directly.',
    };
  }

  if (grouping(a) && grouping(b)) {
    const res = chiSquareTest(av.map((v) => (v == null ? null : groupKey(a, v))), bv.map((v) => (v == null ? null : groupKey(b, v))));
    if (!res) return null;
    const ev = evidence(res.p);
    return {
      test: 'Chi-square test', term: 'chisquare', p: res.p, verdict: ev,
      headline: `${ev.text} (${formatP(res.p)}).`,
      details: [
        `Checks whether ${b.name} is spread differently across the values of ${a.name} (${res.n} rows).`,
        `Strength of the association: ${sizeWord(res.cramersV, 0.1, 0.3, 0.5)} (Cramér's V = ${res.cramersV.toFixed(2)}).`,
      ],
      caution: res.lowExpectedShare > 0.2 ? 'Some combinations have very few rows, so this result is less reliable.' : null,
    };
  }
  return null;
}
