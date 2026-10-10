// "What drives X?": rank every other column by how strongly it is related to a target column.
//
// Strength is always "share of variation explained" (0–1) so different kinds of columns
// can be compared on one scale:
//   number → number      r²            (correlation squared)
//   category → number    η² (eta²)     (from one-way ANOVA)
//   number → category    η²            (the number compared across the target's groups)
//   category → category  Cramér's V²

import { groupKey } from './transform.js';
import { isNum, mean } from './stats.js';
import { chiSquareTest, correlationTest, oneWayAnova } from './significance.js';

const MAX_GROUPS = 30;
const isGroup = (c) => c.type === 'category' || c.type === 'boolean';
const label = (v) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
const pct = (x) => `${Math.round(x * 100)}%`;
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2));

function groupsOf(groupCol, gv, nv) {
  const groups = new Map();
  gv.forEach((g, k) => {
    if (g == null || !isNum(nv[k])) return;
    const key = groupKey(groupCol, g);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(nv[k]);
  });
  return groups;
}

/** Can this column be a target? Numbers, or categories with a manageable number of groups. */
export function canBeTarget(col) {
  if (col.type === 'number') return true;
  return isGroup(col) && new Set(col.values.filter((v) => v != null)).size <= 10;
}

export function strengthWord(s) {
  if (s >= 0.25) return 'strong';
  if (s >= 0.09) return 'moderate';
  if (s >= 0.02) return 'weak';
  return 'very weak';
}

/**
 * Returns [{ column, index, strength, p, method, direction?, sentence }] sorted strongest first.
 */
export function keyDrivers(dataset, indices, targetIndex) {
  const target = dataset.columns[targetIndex];
  const tv = indices.map((i) => target.values[i]);
  const out = [];

  dataset.columns.forEach((col, index) => {
    if (index === targetIndex) return;
    const cv = indices.map((i) => col.values[i]);
    const present = cv.filter((v) => v != null);
    // Skip ID-like columns: unique per row, they "explain" everything and mean nothing.
    if (present.length > 10 && new Set(present).size === present.length && col.type !== 'number') return;
    if (col.type === 'date' || col.type === 'text') return;

    if (target.type === 'number' && col.type === 'number') {
      const t = correlationTest(cv, tv);
      if (!t) return;
      const up = t.r > 0;
      out.push({
        column: col.name, index, strength: t.r * t.r, p: t.p, method: 'correlation', direction: up ? 'up' : 'down',
        sentence: `Rows with higher ${col.name} tend to have ${up ? 'higher' : 'lower'} ${target.name} (r = ${t.r.toFixed(2)}, explains ${pct(t.r * t.r)}).`,
      });
    } else if (target.type === 'number' && isGroup(col)) {
      const groups = groupsOf(col, cv, tv);
      const usable = [...groups.entries()].filter(([, xs]) => xs.length >= 2);
      if (usable.length < 2 || usable.length > MAX_GROUPS) return;
      const res = oneWayAnova(usable.map(([, xs]) => xs));
      if (!res) return;
      const means = usable.map(([g, xs]) => ({ g, m: mean(xs) })).sort((a, b) => b.m - a.m);
      out.push({
        column: col.name, index, strength: res.eta2, p: res.p, method: 'group comparison',
        sentence: `${target.name} is highest when ${col.name} is "${label(means[0].g)}" (avg ${fmt(means[0].m)}) and lowest for "${label(means[means.length - 1].g)}" (avg ${fmt(means[means.length - 1].m)}). Explains ${pct(res.eta2)}.`,
      });
    } else if (isGroup(target) && col.type === 'number') {
      const groups = groupsOf(target, tv, cv);
      const usable = [...groups.entries()].filter(([, xs]) => xs.length >= 2);
      if (usable.length < 2) return;
      const res = oneWayAnova(usable.map(([, xs]) => xs));
      if (!res) return;
      const means = usable.map(([g, xs]) => ({ g, m: mean(xs) })).sort((a, b) => b.m - a.m);
      out.push({
        column: col.name, index, strength: res.eta2, p: res.p, method: 'group comparison',
        sentence: `Average ${col.name} is ${fmt(means[0].m)} when ${target.name} is "${label(means[0].g)}" vs ${fmt(means[means.length - 1].m)} when it is "${label(means[means.length - 1].g)}". Explains ${pct(res.eta2)}.`,
      });
    } else if (isGroup(target) && isGroup(col)) {
      if (new Set(present).size > MAX_GROUPS) return;
      const res = chiSquareTest(tv.map((v) => (v == null ? null : label(v))), cv.map((v) => (v == null ? null : label(v))));
      if (!res) return;
      const v2 = res.cramersV ** 2;
      out.push({
        column: col.name, index, strength: v2, p: res.p, method: 'association',
        sentence: `${target.name} is spread differently across the values of ${col.name} (Cramér's V = ${res.cramersV.toFixed(2)}).`,
      });
    }
  });

  return out.filter((d) => Number.isFinite(d.strength)).sort((a, b) => b.strength - a.strength);
}
