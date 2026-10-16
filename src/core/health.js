// Data health check: finds common problems and proposes a cleaning step that fixes each.
//
// Every issue is { id, severity, title, detail, column?, fix?, safe }.
//   severity: 'high' (will distort results) | 'medium' | 'low'
//   fix:      a cleaning step (see clean.js) or null when only a person can decide
//   safe:     the fix never throws away real information, so "Fix all" may apply it

import { duplicateRows } from './clean.js';
import { isMissingRaw, parseDate, parseNumber } from './infer.js';

const SAMPLE = 20_000;

function sample(values) {
  if (values.length <= SAMPLE) return values;
  const step = values.length / SAMPLE;
  return Array.from({ length: SAMPLE }, (_, k) => values[Math.floor(k * step)]);
}

const pct = (part, whole) => {
  const p = (part / whole) * 100;
  return p < 1 ? '<1%' : `${Math.round(p)}%`;
};
const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const quoteList = (xs) => xs.map((x) => `"${x}"`).join(', ');

/** Groups spellings that differ only in capital letters or spacing. Returns [{ to, variants }]. */
export function spellingVariants(col) {
  const counts = new Map();
  for (const r of col.raw) {
    if (isMissingRaw(r)) continue;
    const s = String(r);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const groups = new Map();
  for (const [s, n] of counts) {
    const key = s.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ s, n });
  }
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // The most common spelling wins; ties go to tidy spacing, then to the first one in the file.
    const tidy = (x) => (x.s === x.s.trim().replace(/\s+/g, ' ') ? 1 : 0);
    list.sort((a, b) => b.n - a.n || tidy(b) - tidy(a));
    const to = list[0].s.trim().replace(/\s+/g, ' ');
    const variants = list.map((x) => x.s).filter((s) => s !== to);
    if (variants.length) out.push({ to, variants, rows: list.reduce((n, x) => n + (x.s === to ? 0 : x.n), 0) });
  }
  return out;
}

/** Run every check. Cheap enough for millions of rows (type checks use a sample). */
export function healthCheck(ds) {
  const issues = [];
  const n = ds.rowCount;
  if (!n) return issues;

  const dups = duplicateRows(ds).length;
  if (dups) {
    issues.push({
      id: 'duplicates', severity: 'high', safe: true,
      title: `${plural(dups, 'duplicate row')}`,
      detail: `${pct(dups, n)} of rows are exact copies of an earlier row. They inflate counts and totals.`,
      fix: { op: 'removeDuplicates' }, fixLabel: 'Remove duplicates',
    });
  }

  for (const col of ds.columns) {
    const missing = col.values.reduce((k, v) => k + (v == null), 0);

    if (missing === n) {
      issues.push({
        id: `empty:${col.name}`, column: col.name, severity: 'medium', safe: true,
        title: `${col.name} is empty`, detail: 'Every value in this column is missing, so it adds nothing.',
        fix: { op: 'delete', column: col.name }, fixLabel: 'Delete column',
      });
      continue;
    }

    if (missing / n >= 0.8) {
      issues.push({
        id: `sparse:${col.name}`, column: col.name, severity: 'low', safe: false,
        title: `${col.name} is mostly empty`, detail: `${pct(missing, n)} of its values are missing. Results that use it rest on very few rows.`,
        fix: { op: 'delete', column: col.name }, fixLabel: 'Delete column',
      });
    } else if (missing && col.type === 'number') {
      // Values that were typed but aren't numbers ("n/a?", "unknown") silently become blanks.
      const unreadable = [];
      for (let i = 0; i < n && unreadable.length < 1000; i++) if (col.values[i] == null && !isMissingRaw(col.raw[i])) unreadable.push(String(col.raw[i]).trim());
      const examples = [...new Set(unreadable)].slice(0, 3);
      issues.push({
        id: `missing:${col.name}`, column: col.name, severity: unreadable.length ? 'medium' : 'low', safe: false,
        title: unreadable.length
          ? `${col.name} has ${plural(missing, 'blank or unreadable value')}`
          : `${col.name} has ${plural(missing, 'missing value')}`,
        detail: `${pct(missing, n)} of rows have no usable ${col.name}${examples.length ? ` (some say ${quoteList(examples)}, which aren't numbers)` : ''}. Averages skip them; filling with the median keeps those rows in every analysis.`,
        fix: { op: 'fillMissing', column: col.name, method: 'median' }, fixLabel: 'Fill with the median',
      });
    }

    if (col.type === 'category' || col.type === 'text') {
      const present = sample(col.raw.filter((r) => !isMissingRaw(r)).map((r) => String(r).trim()));
      const share = (parse) => present.reduce((k, s) => k + (parse(s) != null), 0) / present.length;
      const asNumber = share(parseNumber);
      const asDate = asNumber < 0.6 ? share(parseDate) : 0;
      const target = asNumber >= 0.6 ? 'number' : asDate >= 0.6 ? 'date' : null;
      if (target) {
        const parse = target === 'number' ? parseNumber : parseDate;
        const bad = [...new Set(present.filter((s) => parse(s) == null))];
        issues.push({
          id: `type:${col.name}`, column: col.name, severity: 'high', safe: false,
          title: `${col.name} looks like ${target === 'number' ? 'numbers' : 'dates'} stored as text`,
          detail: `${Math.round((target === 'number' ? asNumber : asDate) * 100)}% of values are ${target === 'number' ? 'numbers' : 'dates'}, but a few aren't (e.g. ${quoteList(bad.slice(0, 3))}), so Lumora can't ${target === 'number' ? 'add or average' : 'chart'} it. Treating it as ${target === 'number' ? 'a number' : 'a date'} column marks those values as missing.`,
          fix: { op: 'setType', column: col.name, type: target }, fixLabel: `Treat as ${target}`,
        });
        continue;
      }

      const variants = col.type === 'category' ? spellingVariants(col) : [];
      if (variants.length) {
        const map = {};
        for (const g of variants) for (const v of g.variants) map[v] = g.to;
        const rows = variants.reduce((k, g) => k + g.rows, 0);
        const example = variants[0];
        issues.push({
          id: `variants:${col.name}`, column: col.name, severity: 'medium', safe: true,
          title: `${col.name} has ${plural(Object.keys(map).length, 'spelling variant')}`,
          detail: `Values like ${quoteList([example.to, ...example.variants].slice(0, 3))} differ only in capitals or spaces, so they're counted as separate groups (${plural(rows, 'row')} affected).`,
          fix: { op: 'standardize', column: col.name, map }, fixLabel: 'Merge variants',
        });
      } else {
        let spaced = 0;
        for (const r of col.raw) if (r != null && /^\s|\s$|\s{2}/.test(r)) spaced++;
        if (spaced) {
          issues.push({
            id: `spaces:${col.name}`, column: col.name, severity: 'low', safe: true,
            title: `Extra spaces in ${col.name}`, detail: `${plural(spaced, 'value')} ${spaced === 1 ? 'has' : 'have'} spaces at the start or end, or doubled spaces.`,
            fix: { op: 'text', column: col.name, transform: 'trim' }, fixLabel: 'Tidy spaces',
          });
        }
      }
    }

    if (n > 1 && missing === 0 && col.type !== 'text') {
      const first = col.raw[0];
      if (col.raw.every((r) => r === first)) {
        issues.push({
          id: `constant:${col.name}`, column: col.name, severity: 'low', safe: false,
          title: `${col.name} has the same value in every row`, detail: `Every row says "${first}". It can't explain any differences, so you may not need it.`,
          fix: { op: 'delete', column: col.name }, fixLabel: 'Delete column',
        });
      }
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** 0–100: how ready the data is for analysis. Each issue costs points by severity. */
export function healthScore(issues) {
  const cost = { high: 15, medium: 8, low: 3 };
  return Math.max(0, 100 - issues.reduce((s, i) => s + cost[i.severity], 0));
}
