// "Summarize this data in words": a short written report built from the analyses,
// in plain English, ready to edit and share. Each section is { heading, text }.

import { defaultMeasure, explainChange, topContributors, unusualPoints } from './analyses.js';
import { trendAndPattern } from './analyses-more.js';
import { keyDrivers } from './drivers.js';
import { healthCheck, healthScore } from './health.js';
import { generateInsights } from './insights.js';
import { formatDate, formatNumber } from './transform.js';

const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const TYPE_WORDS = { number: 'number', date: 'date', boolean: 'yes/no', category: 'category', text: 'text' };

const sample = (rows, max) => {
  if (rows.length <= max) return rows;
  const step = rows.length / max;
  return Array.from({ length: max }, (_, k) => rows[Math.floor(k * step)]);
};

export function writeSummary(ds, rows) {
  const sections = [];
  const n = rows.length;
  if (!n) return [{ heading: 'No rows', text: 'There are no rows to describe. Remove some filters and try again.' }];
  const light = sample(rows, 50_000);

  // What's in the data.
  const counts = {};
  for (const c of ds.columns) counts[c.type] = (counts[c.type] ?? 0) + 1;
  const kinds = Object.entries(counts).map(([t, k]) => `${k} ${TYPE_WORDS[t]}`).join(', ');
  const dateCol = ds.columns.find((c) => c.type === 'date');
  let span = '';
  if (dateCol) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of rows) {
      const t = dateCol.values[i];
      if (t == null) continue;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    if (Number.isFinite(lo)) span = ` It covers ${formatDate(lo)} to ${formatDate(hi)}.`;
  }
  sections.push({ heading: 'The data', text: `“${ds.name}” has ${plural(n, 'row')} and ${plural(ds.columns.length, 'column')} (${kinds}).${span}` });

  // Quality.
  const issues = healthCheck(ds);
  const score = healthScore(issues);
  sections.push({
    heading: 'Data quality',
    text: issues.length
      ? `The data health score is ${score} out of 100. Things to check: ${issues.slice(0, 3).map((i) => i.title.toLowerCase()).join('; ')}${issues.length > 3 ? `, and ${issues.length - 3} more` : ''}.`
      : 'The data health check found no problems.',
  });

  // The main measure: total, trend, latest change, what makes it up, unusual days, what goes with it.
  const measure = defaultMeasure(ds);
  const mCol = ds.columns.find((c) => c.name === measure);
  if (mCol) {
    let sum = 0;
    let k = 0;
    for (const i of rows) if (mCol.values[i] != null) {
      sum += mCol.values[i];
      k++;
    }
    sections.push({ heading: `${mCol.name}`, text: `${mCol.name} adds up to ${formatNumber(sum)}, an average of ${formatNumber(k ? sum / k : 0)} per row.` });
  }
  if (dateCol) {
    const trend = trendAndPattern(ds, rows, { measure });
    if (!trend.error) sections.push({ heading: 'Trend and pattern', text: trend.answer });
    const change = explainChange(ds, rows, { measure });
    if (!change.error) sections.push({ heading: 'Latest change', text: change.answer + (change.partial ? ` (${change.partial})` : '') });
    const unusual = unusualPoints(ds, rows, { measure });
    if (!unusual.error && unusual.flagged.length) sections.push({ heading: 'Unusual moments', text: unusual.answer });
  }
  const top = topContributors(ds, rows, { measure });
  if (!top.error && top.items.length >= 3) sections.push({ heading: 'Where it comes from', text: top.answer });
  if (mCol) {
    const drivers = keyDrivers(ds, sample(rows, 20_000), ds.columns.indexOf(mCol)).filter((d) => d.p < 0.05).slice(0, 2);
    if (drivers.length) sections.push({ heading: `What goes with ${mCol.name}`, text: `${drivers.map((d) => d.sentence).join(' ')} (Related doesn't necessarily mean one causes the other.)` });
  }

  // Anything else Lumora noticed that isn't covered above.
  const extra = generateInsights(ds, light).filter((i) => i.kind === 'highlight').slice(0, 2);
  if (extra.length) sections.push({ heading: 'Also worth knowing', text: extra.map((i) => `${i.title}. ${i.detail}`).join(' ') });
  return sections;
}

/** The summary as plain text (for copying or a report note). */
export function summaryText(sections) {
  return sections.map((s) => `${s.heading}\n${s.text}`).join('\n\n');
}
