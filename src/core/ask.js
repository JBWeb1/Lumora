// "Ask a question": turns plain-English questions into an analysis, entirely on-device.
//
//   "average revenue by weekday"              → summary: mean of revenue grouped by weekday
//   "which major has the highest exam score"  → summary sorted high→low, answer = first row
//   "how many rows where rainy is yes"        → value: count with a filter
//   "total revenue on rainy days"             → value: sum, filter rainy = yes
//   "relationship between hours studied and exam score" → scatter chart
//   "revenue over time"                       → line chart
//   "distribution of sleep hours"             → histogram
//   "what drives exam score"                  → key drivers
//
// It is a pattern matcher, not an AI: it always reports how it understood the question
// so the person can check it, and suggests phrasings when it can't understand.

import { frequencies } from './stats.js';

const norm = (s) => String(s).toLowerCase().replace(/[_\-]+/g, ' ').replace(/[^\p{L}\p{N}.%<>=! ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const AGG_WORDS = [
  [/\b(average|mean|avg|typical)\b/, 'mean'],
  [/\b(total|sum|overall)\b/, 'sum'],
  [/\b(median|middle)\b/, 'median'],
  [/\b(maximum|max|largest|biggest|highest value)\b/, 'max'],
  [/\b(minimum|min|smallest|lowest value)\b/, 'min'],
];
const AGG_LABEL = { mean: 'average', sum: 'total', median: 'median', max: 'maximum', min: 'minimum', count: 'number of rows' };
const MOST = /\b(most|highest|best|top|largest|biggest|greatest|maximum|max)\b/;
const LEAST = /\b(least|lowest|fewest|worst|bottom|smallest|minimum|min)\b/;
const WEEKDAYS = { mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday' };

export const EXAMPLE_QUESTIONS = [
  'average {num} by {cat}',
  'which {cat} has the highest {num}',
  'how many rows where {cat} is {val}',
  'relationship between {num} and {num2}',
  'distribution of {num}',
  'what drives {num}',
];

/** Fill the example templates with this dataset's real column names. */
export function exampleQuestions(dataset) {
  const num = dataset.columns.filter((c) => c.type === 'number');
  const cat = dataset.columns.find((c) => c.type === 'category' && new Set(c.values).size <= 20) ?? dataset.columns.find((c) => c.type === 'boolean');
  const date = dataset.columns.find((c) => c.type === 'date');
  const val = cat ? frequencies(cat.values)[0]?.value : null;
  const out = [];
  if (num[0] && cat) out.push(`average ${num[0].name} by ${cat.name}`, `which ${cat.name} has the highest ${num[0].name}`);
  if (cat && val != null) out.push(`how many rows where ${cat.name} is ${typeof val === 'boolean' ? (val ? 'yes' : 'no') : val}`);
  if (date && num[0]) out.push(`${num[0].name} over time`);
  if (num.length >= 2) out.push(`relationship between ${num[0].name} and ${num[1].name}`);
  if (num[0]) out.push(`distribution of ${num[0].name}`, `what drives ${num[num.length - 1].name}`);
  return out.map((q) => q.replace(/_/g, ' ')).slice(0, 6);
}

/** Every way a column might be written in a question: "exam_score" → "exam score", "exam scores". */
function aliases(name) {
  const n = norm(name);
  const set = new Set([n, `${n}s`, n.replace(/s$/, '')]);
  const words = n.split(' ');
  // "temperature_c" → "temperature", "attendance_pct" → "attendance"
  if (words.length > 1 && words[words.length - 1].length <= 3) set.add(words.slice(0, -1).join(' '));
  return [...set].filter((a) => a.length >= 2);
}

/** Find columns mentioned in the question, longest names first, without overlaps. */
function findColumns(q, columns) {
  const candidates = [];
  columns.forEach((col, index) => {
    for (const a of aliases(col.name)) {
      const re = new RegExp(`(^| )${escapeRe(a)}(?= |$)`, 'g');
      for (const m of q.matchAll(re)) {
        const start = m.index + m[1].length;
        candidates.push({ index, start, end: start + a.length, len: a.length });
      }
    }
  });
  candidates.sort((a, b) => b.len - a.len || a.start - b.start);
  const taken = [];
  const found = [];
  for (const c of candidates) {
    if (taken.some(([s, e]) => c.start < e && c.end > s)) continue;
    taken.push([c.start, c.end]);
    found.push(c);
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Category values mentioned on their own: "Biology", "saturdays", "rainy days". */
function findValues(q, columns, taken) {
  const hits = [];
  columns.forEach((col, index) => {
    if (col.type !== 'category') return;
    const values = new Set(col.values.filter((v) => v != null));
    if (values.size > 60) return;
    for (const v of values) {
      const nv = norm(v);
      if (nv.length < 2) continue;
      const forms = [nv, `${nv}s`];
      if (WEEKDAYS[nv]) forms.push(WEEKDAYS[nv], `${WEEKDAYS[nv]}s`);
      for (const f of forms) {
        const m = new RegExp(`(^| )${escapeRe(f)}(?= |$)`).exec(q);
        if (m && !taken.some(([s, e]) => m.index + m[1].length < e && m.index + m[1].length + f.length > s)) {
          hits.push({ index, value: v, start: m.index + m[1].length, end: m.index + m[1].length + f.length });
          break;
        }
      }
    }
  });
  return hits;
}

const word = (alts) => new RegExp(`^(${alts})(?![a-z])`);
const COMPARISONS = [
  [word('>=|at least|no less than'), '≥'],
  [word('<=|at most|no more than'), '≤'],
  [word('>|above|over|more than|greater than|higher than'), '>'],
  [word('<|below|under|less than|lower than|fewer than'), '<'],
  [word('!=|is not|isn t|not'), 'is not'],
  [word('==|=|is|equals|equal to'), 'is'],
];

/**
 * Understand a question. Returns
 *   { understood, filters: [{ column, op, value }], result }
 * where result is one of
 *   { type: 'value', fn, column }            (column null for counts)
 *   { type: 'summary', by, fn, column, sort, limit, dateUnit }
 *   { type: 'chart', chart: { type, x, y } }
 *   { type: 'drivers', target }
 * or { error, suggestions } when the question can't be understood.
 */
export function parseQuestion(question, dataset) {
  const q = norm(question).replace(/\?/g, '');
  const cols = dataset.columns;
  const name = (i) => cols[i].name;
  if (!q) return { error: 'Type a question about your data.', suggestions: exampleQuestions(dataset) };

  const mentions = findColumns(q, cols);
  const taken = mentions.map((m) => [m.start, m.end]);
  const filters = [];
  const usedForFilter = new Set();

  // "<column> is/above/below <value>" conditions
  for (const m of mentions) {
    const col = cols[m.index];
    // "temperature is above 20" → "temperature above 20"
    const rest = q.slice(m.end).trim().replace(/^(is|are|was|were) (?=(above|over|below|under|more|less|greater|higher|lower|fewer|at least|at most|no more|no less|not|>|<))/, '');
    for (const [re, op] of COMPARISONS) {
      const cm = re.exec(rest);
      if (!cm) continue;
      const after = rest.slice(cm[0].length).trim();
      const valueMatch = /^(-?[\d.,]+%?|[\p{L}\p{N}.]+(?: [\p{L}\p{N}.]+)?)/u.exec(after);
      if (!valueMatch) break;
      let value = valueMatch[1];
      if (col.type === 'number') {
        if (!/^-?[\d.,]+%?$/.test(value)) break;
        filters.push({ column: m.index, op: op === 'is' ? '=' : op === 'is not' ? '≠' : op, value });
      } else if (col.type === 'category' || col.type === 'boolean' || col.type === 'text') {
        if (op !== 'is' && op !== 'is not') break;
        // Match the real category value (case-insensitive, one or two words).
        const values = col.type === 'boolean' ? ['yes', 'no', 'true', 'false'] : [...new Set(col.values.filter((v) => v != null))].map(String);
        const exact = values.find((v) => norm(v) === value) ?? values.find((v) => norm(v) === value.split(' ')[0]);
        if (!exact) break;
        value = exact;
        filters.push({ column: m.index, op: col.type === 'text' ? (op === 'is' ? 'is' : 'is not') : op, value });
      } else break;
      usedForFilter.add(m.index);
      break;
    }
  }

  // Bare category values ("Biology students") and yes/no columns ("on rainy days").
  for (const v of findValues(q, cols, taken)) {
    if (!filters.some((f) => f.column === v.index)) {
      filters.push({ column: v.index, op: 'is', value: v.value });
      usedForFilter.add(v.index);
    }
  }
  const wantsGroupBy = (i) => new RegExp(`\\b(by|per|each|across|which|what) ${escapeRe(norm(name(i)))}`).test(q);
  for (const m of mentions) {
    const col = cols[m.index];
    if (col.type !== 'boolean' || usedForFilter.has(m.index) || wantsGroupBy(m.index)) continue;
    const before = q.slice(0, m.start);
    const after = q.slice(m.end);
    if (/\b(on|when|for|with|where|during|in)( (the|a|an))?( (not|non))? $/.test(before) || /^ (days|rows|ones|cases|times|students|people|customers|items)\b/.test(after)) {
      const negated = /\b(not|non|no) $/.test(before);
      filters.push({ column: m.index, op: 'is', value: negated ? 'no' : 'yes' });
      usedForFilter.add(m.index);
    }
  }

  const free = mentions.map((m) => m.index).filter((i) => !usedForFilter.has(i));
  const unique = [...new Set(free)];
  const nums = unique.filter((i) => cols[i].type === 'number');
  const groups = unique.filter((i) => cols[i].type === 'category' || cols[i].type === 'boolean');
  const dates = unique.filter((i) => cols[i].type === 'date');
  let fn = null;
  for (const [re, f] of AGG_WORDS) if (re.test(q)) { fn = f; break; }
  const counting = /\b(how many|count|number of)\b/.test(q);
  const describeFilters = () => (filters.length ? ` where ${filters.map((f) => `${name(f.column)} ${f.op} ${f.value}`).join(' and ')}` : '');
  const done = (result, understood) => ({ understood: understood + describeFilters(), filters, result });

  // What drives X?
  if (/\b(what )?(drives|affects|influences|predicts|explains|impacts)\b|\bdrivers? (of|for)\b|\bfactors\b/.test(q) && unique.length >= 1) {
    const target = unique.find((i) => cols[i].type === 'number') ?? unique[0];
    return done({ type: 'drivers', target }, `Find what is most related to ${name(target)}`);
  }

  // Relationship between two numbers
  if (nums.length >= 2 && /\b(correlat\w*|relationship|related|relate|vs|versus|against|compared? to|and)\b/.test(q) && !counting && !fn && groups.length === 0) {
    return done({ type: 'chart', chart: { type: 'scatter', x: nums[0], y: nums[1] } }, `Scatter plot of ${name(nums[1])} against ${name(nums[0])}`);
  }

  // Distribution
  if (nums.length >= 1 && /\b(distribution|distributed|spread|histogram|range)\b/.test(q)) {
    return done({ type: 'chart', chart: { type: 'histogram', x: nums[0], y: null } }, `Distribution of ${name(nums[0])}`);
  }

  // Over time
  const timeUnit = /\b(daily|per day|by day|each day)\b/.test(q) ? 'day' : /\b(yearly|annual\w*|per year|by year|each year)\b/.test(q) ? 'year' : /\b(monthly|per month|by month|each month)\b/.test(q) ? 'month' : null;
  const weekday = /\b(weekday|day of (the )?week)\b/.test(q);
  const dateCol = dates[0] ?? (timeUnit || /\b(over time|trend|timeline)\b/.test(q) ? cols.findIndex((c) => c.type === 'date') : -1);
  if (dateCol >= 0 && (timeUnit || /\b(over time|trend|timeline)\b/.test(q) || (dates.length && !groups.length))) {
    if (weekday || timeUnit) {
      const unit = weekday ? 'weekday' : timeUnit;
      const f = nums.length ? fn ?? 'mean' : 'count';
      return done({ type: 'summary', by: dateCol, dateUnit: unit, fn: f, column: nums[0] ?? null, sort: null }, `${nums.length ? `${AGG_LABEL[f]} ${name(nums[0])}` : 'Number of rows'} per ${unit === 'weekday' ? 'day of the week' : unit} of ${name(dateCol)}`);
    }
    return done({ type: 'chart', chart: { type: 'line', x: dateCol, y: nums[0] ?? null } }, `${nums.length ? name(nums[0]) : 'Number of rows'} over time`);
  }

  // Grouped questions: "X by Y", "which Y has the most X"
  if (groups.length) {
    const by = groups.find((i) => wantsGroupBy(i)) ?? groups[0];
    const measure = nums[0] ?? null;
    const f = counting || measure == null ? 'count' : fn ?? 'mean';
    const sort = LEAST.test(q) ? 'asc' : MOST.test(q) || /\bwhich\b/.test(q) ? 'desc' : null;
    const limitMatch = /\b(top|bottom) (\d+)\b/.exec(q);
    const limit = limitMatch ? Number(limitMatch[2]) : /\bwhich\b/.test(q) && sort ? 1 : null;
    const what = f === 'count' ? 'Number of rows' : `${AGG_LABEL[f]} ${name(measure)}`;
    return done({ type: 'summary', by, fn: f, column: f === 'count' ? null : measure, sort, limit },
      `${what[0].toUpperCase()}${what.slice(1)} for each ${name(by)}${sort ? `, ${sort === 'desc' ? 'highest' : 'lowest'} first` : ''}`);
  }

  // Single values
  if (counting) return done({ type: 'value', fn: 'count', column: null }, 'Count the rows');
  if (nums.length) {
    const f = fn ?? (MOST.test(q) ? 'max' : LEAST.test(q) ? 'min' : 'mean');
    return done({ type: 'value', fn: f, column: nums[0] }, `The ${AGG_LABEL[f]} of ${name(nums[0])}`);
  }
  if (filters.length) return done({ type: 'value', fn: 'count', column: null }, 'Count the rows');
  if (unique.length === 1) {
    return done({ type: 'chart', chart: { type: 'bar', x: unique[0], y: null } }, `How often each value of ${name(unique[0])} appears`);
  }

  return {
    error: mentions.length ? "I found the columns but couldn't work out the question." : "I couldn't find any of your column names in that question.",
    suggestions: exampleQuestions(dataset),
  };
}
