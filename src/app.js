import { datasetFromText, setColumnType, TYPES } from './core/infer.js';
import { describe, frequencies, histogram, numbers, correlationMatrix, correlationStrength } from './core/stats.js';
import {
  AGGREGATIONS, FILTER_OPS, NO_VALUE_OPS, applyFilters, datasetToCSV, formatDate, formatNumber, formatValue,
  groupBy, searchRows, sortIndices, toCSV,
} from './core/transform.js';
import { generateInsights } from './core/insights.js';
import { CHART_TYPES, buildChartData, suggestChart } from './core/chartspec.js';
import { GLOSSARY, LESSONS } from './core/learn.js';
import { SAMPLES, sampleCSV } from './core/samples.js';
import { el, clear, select, download, installTooltip } from './ui/dom.js';
import { renderChart, heatmap, sparkHistogram } from './ui/charts.js';

// ---------- state ----------

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`lumora.${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`lumora.${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable – preferences just won't persist */
    }
  },
};

const state = {
  dataset: null,
  filters: [],
  tab: 'overview',
  learn: store.get('learn', true),
  table: { sort: null, dir: 'asc', page: 0, search: '' },
  chart: { type: 'auto', x: null, y: null, agg: 'mean' },
  summarize: { by: null, dateUnit: 'month', aggs: [{ fn: 'count', column: null }] },
  addingFilter: null,
};

let indices = [];

const TABS = [
  { id: 'overview', label: 'Overview', icon: '✦' },
  { id: 'table', label: 'Table', icon: '▦' },
  { id: 'chart', label: 'Chart', icon: '∿' },
  { id: 'summarize', label: 'Summarize', icon: 'Σ' },
  { id: 'learn', label: 'Learn', icon: '?' },
];

const TYPE_LABELS = { number: 'Number', date: 'Date', boolean: 'Yes / No', category: 'Category', text: 'Text' };
const TYPE_ICONS = { number: '#', date: '◷', boolean: '✓', category: '◆', text: 'Aa' };

const $app = document.getElementById('app');
const $name = document.getElementById('dataset-name');
const $fileInput = document.getElementById('file-input');
const $dialog = document.getElementById('dialog');

// ---------- helpers ----------

const cols = () => state.dataset.columns;
const colIndex = (name) => cols().findIndex((c) => c.name === name);
const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

function toast(message, kind = 'error') {
  document.querySelectorAll('.toast').forEach((old) => old.remove());
  const t = el('div', { class: `toast ${kind}`, role: 'status' }, message);
  document.body.append(t);
  setTimeout(() => t.classList.add('gone'), 3800);
  setTimeout(() => t.remove(), 4300);
}

function termLink(key, text) {
  const g = GLOSSARY[key];
  if (!g) return text;
  return el('button', { class: 'term', type: 'button', title: g.short, onclick: () => openTerm(key) }, text ?? g.term);
}

function learnTip(key, extra) {
  if (!state.learn) return null;
  const g = GLOSSARY[key];
  return el('aside', { class: 'learn-tip' },
    el('span', { class: 'learn-icon', 'aria-hidden': 'true' }, '💡'),
    el('div', {}, el('strong', {}, g.term + ': '), extra ?? g.short, ' ', termLink(key, 'Learn more')));
}

function openDialog(title, ...content) {
  clear($dialog).append(
    el('div', { class: 'dialog-head' },
      el('h2', {}, title),
      el('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => $dialog.close() }, '✕')),
    el('div', { class: 'dialog-body' }, content)
  );
  if (!$dialog.open) $dialog.showModal();
}

function openTerm(key) {
  const g = GLOSSARY[key];
  openDialog(g.term, el('p', { class: 'lead' }, g.short), el('p', {}, g.body));
}

function recompute() {
  indices = state.dataset ? applyFilters(state.dataset, state.filters) : [];
}

function update() {
  recompute();
  render();
}

// ---------- loading ----------

function chooseDefaults() {
  const c = cols();
  const find = (...types) => c.findIndex((col) => types.includes(col.type));
  const num = find('number');
  const date = find('date');
  const cat = find('category', 'boolean');
  state.filters = [];
  state.table = { sort: null, dir: 'asc', page: 0, search: '' };
  state.chart = date >= 0 && num >= 0
    ? { type: 'auto', x: date, y: num, agg: 'mean' }
    : { type: 'auto', x: num >= 0 ? num : 0, y: null, agg: 'mean' };
  const by = cat >= 0 ? cat : date >= 0 ? date : 0;
  state.summarize = { by, dateUnit: 'month', aggs: [{ fn: 'count', column: null }, ...(num >= 0 ? [{ fn: 'mean', column: num }] : [])] };
}

function loadText(text, fileName) {
  try {
    const ds = datasetFromText(text, fileName);
    if (!ds.columns.length || !ds.rowCount) throw new Error('No rows found. Is the first line a header row?');
    state.dataset = ds;
    chooseDefaults();
    state.tab = 'overview';
    update();
    return true;
  } catch (err) {
    toast(`Couldn't read ${fileName}: ${err.message}`);
    return false;
  }
}

function loadFile(file) {
  if (!file) return;
  if (file.size > 200 * 1024 * 1024) {
    toast('That file is over 200 MB. Lumora runs in your browser and works best with files under 50 MB.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => loadText(String(reader.result), file.name);
  reader.onerror = () => toast(`Couldn't open ${file.name}.`);
  reader.readAsText(file);
}

function loadSample(id) {
  const sample = SAMPLES.find((s) => s.id === id);
  return loadText(sampleCSV(id), `${sample.name}.csv`);
}

function runLesson(lesson) {
  const t = lesson.try;
  if (state.dataset?.name !== SAMPLES.find((s) => s.id === t.sample).name) loadSample(t.sample);
  else state.filters = [];
  if (t.chart) {
    state.chart = { type: t.chart.type ?? 'auto', x: colIndex(t.chart.x), y: t.chart.y ? colIndex(t.chart.y) : null, agg: 'mean' };
  }
  if (t.summarize) {
    state.summarize = {
      by: colIndex(t.summarize.by),
      dateUnit: 'month',
      aggs: t.summarize.aggs.map((a) => ({ fn: a.fn, column: a.column ? colIndex(a.column) : null })),
    };
  }
  state.tab = t.tab;
  update();
  toast(lesson.title.replace(/^\d+\.\s*/, 'Lesson: '), 'info');
}

// ---------- home ----------

function renderHome() {
  const drop = el('button', { class: 'dropzone', type: 'button', onclick: () => $fileInput.click() },
    el('div', { class: 'drop-icon', 'aria-hidden': 'true' }, '⇪'),
    el('div', { class: 'drop-title' }, 'Drop a file here, or click to choose'),
    el('div', { class: 'muted' }, 'CSV, TSV or JSON. Your data stays on your computer and is never uploaded.'));

  return el('div', { class: 'home' },
    el('section', { class: 'hero' },
      el('h1', {}, 'Understand your data ', el('span', { class: 'glow' }, 'in seconds')),
      el('p', { class: 'lead' }, 'Lumora reads your spreadsheet, explains what is inside in plain English, and helps you build the right chart, even if you have never studied statistics.'),
      drop),
    el('section', {},
      el('h2', {}, 'Or start with practice data'),
      el('div', { class: 'cards' }, SAMPLES.map((s) =>
        el('button', { class: 'card sample', type: 'button', onclick: () => loadSample(s.id) },
          el('div', { class: 'emoji', 'aria-hidden': 'true' }, s.emoji),
          el('h3', {}, s.name),
          el('p', { class: 'muted' }, s.description))))),
    el('section', {},
      el('h2', {}, 'Learn data analysis step by step'),
      el('div', { class: 'lessons' }, LESSONS.map(lessonCard))),
    el('section', { class: 'steps' },
      [['1', 'Load', 'Drop in a file. Lumora detects numbers, dates and categories for you.'],
       ['2', 'Explore', 'Get automatic insights, column profiles and a searchable table.'],
       ['3', 'Answer', 'Filter, group and chart to answer your question, then export the results.']]
        .map(([n, t, d]) => el('div', { class: 'step' }, el('span', { class: 'step-n' }, n), el('div', {}, el('strong', {}, t), el('p', { class: 'muted' }, d))))));
}

function lessonCard(lesson) {
  return el('article', { class: 'card lesson' },
    el('h3', {}, lesson.title),
    el('p', {}, lesson.body),
    el('div', { class: 'term-row' }, lesson.terms.map((t) => termLink(t))),
    el('button', { class: 'btn primary small', type: 'button', onclick: () => runLesson(lesson) }, 'Try it →'));
}

// ---------- workspace ----------

function renderWorkspace() {
  const nav = el('nav', { class: 'tabs', role: 'tablist' }, TABS.map((t) =>
    el('button', {
      class: `tab${state.tab === t.id ? ' active' : ''}`, role: 'tab', type: 'button',
      'aria-selected': String(state.tab === t.id),
      onclick: () => { state.tab = t.id; render(); },
    }, el('span', { class: 'tab-icon', 'aria-hidden': 'true' }, t.icon), t.label)));

  const views = { overview: renderOverview, table: renderTable, chart: renderChartTab, summarize: renderSummarize, learn: renderLearn };
  return el('div', { class: 'workspace' }, nav, state.tab !== 'learn' && renderFilterBar(), el('div', { class: 'view' }, views[state.tab]()));
}

// ---------- filters ----------

function describeFilter(f) {
  const c = cols()[f.column];
  return NO_VALUE_OPS.has(f.op) ? `${c.name} ${f.op}` : `${c.name} ${f.op} ${f.value}`;
}

function renderFilterBar() {
  const total = state.dataset.rowCount;
  const bar = el('div', { class: 'filter-bar' },
    el('span', { class: 'row-count' }, state.filters.length ? `${plural(indices.length, 'row')} of ${total.toLocaleString('en-US')}` : plural(total, 'row')),
    state.filters.map((f, i) =>
      el('span', { class: 'chip' }, describeFilter(f),
        el('button', { class: 'chip-x', 'aria-label': `Remove filter ${describeFilter(f)}`, onclick: () => { state.filters.splice(i, 1); state.table.page = 0; update(); } }, '✕'))),
    state.addingFilter ? filterForm() : el('button', { class: 'btn ghost small', type: 'button', onclick: () => { state.addingFilter = { column: 0, op: FILTER_OPS[cols()[0].type][0], value: '' }; render(); } }, '+ Filter'),
    state.filters.length > 1 && el('button', { class: 'btn ghost small', type: 'button', onclick: () => { state.filters = []; update(); } }, 'Clear all'));
  return el('div', {}, bar, state.addingFilter && learnTip('filter'));
}

function filterForm() {
  const f = state.addingFilter;
  const col = cols()[f.column];
  const ops = FILTER_OPS[col.type];
  const needsValue = !NO_VALUE_OPS.has(f.op);
  const listId = 'filter-values';
  const suggestions = col.type === 'category' || col.type === 'text'
    ? frequencies(col.values).slice(0, 50).map((x) => x.value)
    : col.type === 'boolean' ? ['yes', 'no'] : [];
  const apply = (e) => {
    e.preventDefault();
    if (needsValue && !String(f.value).trim()) return;
    state.filters.push({ ...f });
    state.addingFilter = null;
    state.table.page = 0;
    update();
  };
  return el('form', { class: 'filter-form', onsubmit: apply },
    select(cols().map((c, i) => ({ value: i, label: c.name })), f.column, (v) => {
      f.column = +v;
      f.op = FILTER_OPS[cols()[f.column].type][0];
      f.value = '';
      render();
    }, { 'aria-label': 'Column' }),
    select(ops.map((o) => ({ value: o, label: o })), f.op, (v) => { f.op = v; render(); }, { 'aria-label': 'Condition' }),
    needsValue && el('input', {
      type: col.type === 'date' ? 'date' : 'text',
      value: f.value, placeholder: col.type === 'number' ? 'e.g. 100' : 'value',
      list: suggestions.length ? listId : null, 'aria-label': 'Value', autofocus: true,
      oninput: (e) => { f.value = e.target.value; },
    }),
    suggestions.length && el('datalist', { id: listId }, suggestions.map((s) => el('option', { value: s }))),
    el('button', { class: 'btn primary small', type: 'submit' }, 'Apply'),
    el('button', { class: 'btn ghost small', type: 'button', onclick: () => { state.addingFilter = null; render(); } }, 'Cancel'));
}

// ---------- overview ----------

function renderOverview() {
  const ds = state.dataset;
  const c = cols();
  const cells = indices.length * c.length;
  let missing = 0;
  for (const col of c) for (const i of indices) if (col.values[i] == null) missing++;
  const insights = generateInsights(ds, indices);
  const numeric = c.filter((col) => col.type === 'number');

  return el('div', { class: 'overview' },
    el('div', { class: 'kpis' },
      kpi('Rows', indices.length.toLocaleString('en-US')),
      kpi('Columns', c.length),
      kpi('Missing cells', cells ? `${((missing / cells) * 100).toFixed(1)}%` : '–', 'missing'),
      kpi('Column types', Object.entries(TYPE_LABELS).map(([t, label]) => {
        const n = c.filter((col) => col.type === t).length;
        return n ? `${n} ${label.toLowerCase()}` : null;
      }).filter(Boolean).join(' · '), 'types', true)),
    el('section', {},
      el('h2', {}, 'What Lumora noticed'),
      learnTip('types', 'Lumora reads every column, works out what kind of data it holds and flags anything interesting or suspicious.'),
      el('div', { class: 'insights' }, insights.map(insightCard))),
    el('section', {},
      el('h2', {}, 'Columns'),
      el('div', { class: 'column-grid' }, c.map((col, i) => columnCard(col, i)))),
    numeric.length >= 2 && el('section', {},
      el('h2', {}, 'How number columns relate'),
      learnTip('correlation'),
      el('div', { class: 'card chart-card scroll-x' }, (() => {
        const shown = numeric.slice(0, 12);
        const { names, matrix } = correlationMatrix(shown.map((col) => ({ name: col.name, values: indices.map((i) => col.values[i]) })));
        return heatmap(names, matrix);
      })())));
}

function kpi(label, value, term, wide) {
  return el('div', { class: `kpi${wide ? ' wide' : ''}` }, el('div', { class: 'kpi-label' }, term ? termLink(term, label) : label), el('div', { class: 'kpi-value' }, value));
}

const INSIGHT_ICONS = { warning: '!', highlight: '★', info: 'i' };

function insightCard(ins) {
  return el('article', { class: `insight ${ins.kind}` },
    el('span', { class: 'insight-icon', 'aria-hidden': 'true' }, INSIGHT_ICONS[ins.kind]),
    el('div', { class: 'insight-body' },
      el('h3', {}, ins.title),
      el('p', {}, ins.detail),
      el('div', { class: 'insight-actions' },
        ins.action && el('button', { class: 'btn small', type: 'button', onclick: () => showAction(ins.action) }, 'Show me →'),
        ins.term && termLink(ins.term, `What is ${GLOSSARY[ins.term].term.toLowerCase()}?`))));
}

function showAction(action) {
  state.chart = { type: action.type, x: action.x, y: action.y ?? null, agg: 'mean' };
  state.tab = 'chart';
  render();
}

function columnCard(col, index) {
  const values = indices.map((i) => col.values[i]);
  const present = values.filter((v) => v != null);
  const missingPct = values.length ? (1 - present.length / values.length) * 100 : 0;
  let body;
  if (col.type === 'number' && present.length) {
    const d = describe(present);
    body = [sparkHistogram(histogram(present, 16)), statLine([['mean', d.mean, 'mean'], ['median', d.median, 'median'], ['min', d.min], ['max', d.max]])];
  } else if (col.type === 'date' && present.length) {
    const ts = numbers(present);
    body = el('p', { class: 'muted' }, `${formatDate(Math.min(...ts))} → ${formatDate(Math.max(...ts))}`);
  } else if (present.length) {
    const freq = frequencies(present);
    const top = freq.slice(0, 4);
    if (freq[0].count === 1) {
      body = [el('p', { class: 'muted small' }, `Every value is different (${plural(freq.length, 'distinct value')}), e.g.`),
        el('p', { class: 'sample-values' }, top.map((f) => formatValue(f.value, col.type)).join(', '))];
    } else body = [
      el('div', { class: 'mini-bars' }, top.map((f) =>
        el('div', { class: 'mini-bar', 'data-tip': `${formatValue(f.value, col.type)}: ${f.count} rows` },
          el('span', { class: 'mini-label' }, formatValue(f.value, col.type)),
          el('span', { class: 'mini-track' }, el('span', { class: 'mini-fill', style: { width: `${(f.count / present.length) * 100}%` } })),
          el('span', { class: 'mini-pct' }, `${Math.round((f.count / present.length) * 100)}%`)))),
      freq.length > 4 && el('p', { class: 'muted small' }, `${plural(freq.length, 'distinct value')}`),
    ];
  } else {
    body = el('p', { class: 'muted' }, 'No values.');
  }
  return el('article', { class: 'card column-card' },
    el('header', {},
      el('span', { class: `type-badge t-${col.type}`, title: TYPE_LABELS[col.type] }, TYPE_ICONS[col.type]),
      el('h3', { title: col.name }, col.name)),
    el('div', { class: 'col-meta' },
      select(TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] + (t === col.inferredType ? ' (detected)' : '') })), col.type, (t) => {
        setColumnType(state.dataset, index, t);
        update();
      }, { class: 'type-select', 'aria-label': `Type of ${col.name}` }),
      missingPct > 0 && el('span', { class: 'pill warn' }, `${missingPct < 1 ? '<1' : Math.round(missingPct)}% missing`)),
    body,
    el('button', { class: 'btn ghost small', type: 'button', onclick: () => openProfile(index) }, 'Details'));
}

function statLine(items) {
  return el('dl', { class: 'stat-line' }, items.map(([label, v, term]) => el('div', {}, el('dt', {}, term ? termLink(term, label) : label), el('dd', {}, formatNumber(v)))));
}

function openProfile(index) {
  const col = cols()[index];
  const values = indices.map((i) => col.values[i]);
  const present = values.filter((v) => v != null);
  const rows = [
    ['Type', TYPE_LABELS[col.type], 'types'],
    ['Rows', values.length.toLocaleString('en-US')],
    ['Missing', `${values.length - present.length} (${values.length ? Math.round(((values.length - present.length) / values.length) * 100) : 0}%)`, 'missing'],
    ['Distinct values', new Set(present).size.toLocaleString('en-US')],
  ];
  let chartData = null;
  if (col.type === 'number' && present.length) {
    const d = describe(present);
    rows.push(
      ['Mean', formatNumber(d.mean), 'mean'], ['Median', formatNumber(d.median), 'median'],
      ['Standard deviation', formatNumber(d.std), 'std'], ['Minimum', formatNumber(d.min)],
      ['Q1 (25th percentile)', formatNumber(d.q1), 'quartiles'], ['Q3 (75th percentile)', formatNumber(d.q3), 'quartiles'],
      ['Maximum', formatNumber(d.max)], ['IQR', formatNumber(d.iqr), 'iqr'],
      ['Skewness', Number.isFinite(d.skew) ? d.skew.toFixed(2) : '–', 'skewness'], ['Outliers', d.outliers, 'outlier'], ['Sum', formatNumber(d.sum)]);
    chartData = buildChartData(state.dataset, indices, { type: 'histogram', x: index });
  } else if (col.type === 'date' && present.length) {
    rows.push(['Earliest', formatDate(Math.min(...present))], ['Latest', formatDate(Math.max(...present))]);
    chartData = buildChartData(state.dataset, indices, { type: 'line', x: index });
  } else if (present.length) {
    const top = frequencies(present)[0];
    rows.push(['Most common', `${formatValue(top.value, col.type)} (${top.count} rows)`]);
    chartData = buildChartData(state.dataset, indices, { type: 'bar', x: index });
  }
  openDialog(col.name,
    el('table', { class: 'profile-table' }, el('tbody', {}, rows.map(([k, v, t]) => el('tr', {}, el('th', {}, t ? termLink(t, k) : k), el('td', {}, String(v)))))),
    chartData && !chartData.error && el('div', { class: 'chart-wrap' }, renderChart(chartData)),
    el('div', { class: 'dialog-actions' },
      el('button', { class: 'btn primary small', onclick: () => { $dialog.close(); state.chart = { type: 'auto', x: index, y: null, agg: 'mean' }; state.tab = 'chart'; render(); } }, 'Open in chart builder'),
      el('button', { class: 'btn small', onclick: () => { $dialog.close(); state.table.sort = index; state.table.dir = 'desc'; state.tab = 'table'; render(); } }, 'Sort table by this column')));
}

// ---------- table ----------

const PAGE_SIZE = 50;

function renderTable() {
  const t = state.table;
  const wrap = el('div', { class: 'table-view' });
  const body = el('div');
  const draw = () => {
    let rows = searchRows(state.dataset, indices, t.search);
    if (t.sort != null) rows = sortIndices(state.dataset, rows, t.sort, t.dir);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    t.page = Math.min(t.page, pages - 1);
    const pageRows = rows.slice(t.page * PAGE_SIZE, (t.page + 1) * PAGE_SIZE);
    clear(body).append(
      el('div', { class: 'table-scroll card' },
        el('table', { class: 'data-table' },
          el('thead', {}, el('tr', {},
            el('th', { class: 'rownum' }, '#'),
            cols().map((c, j) => el('th', { class: c.type === 'number' ? 'num' : '' },
              el('button', {
                class: 'sort-btn', type: 'button', title: `Sort by ${c.name}`,
                onclick: () => {
                  if (t.sort === j) t.dir = t.dir === 'asc' ? 'desc' : 'asc';
                  else { t.sort = j; t.dir = 'asc'; }
                  draw();
                },
              }, el('span', { class: `type-badge t-${c.type}` }, TYPE_ICONS[c.type]), c.name, t.sort === j ? (t.dir === 'asc' ? ' ▲' : ' ▼') : ''))))),
          el('tbody', {}, pageRows.map((i) => el('tr', {},
            el('td', { class: 'rownum' }, i + 1),
            cols().map((c) => {
              const v = c.values[i];
              return v == null
                ? el('td', { class: 'missing' }, c.raw[i] ? c.raw[i] : '—')
                : el('td', { class: c.type === 'number' ? 'num' : '' }, c.type === 'number' ? c.raw[i] : formatValue(v, c.type));
            })))))),
      el('div', { class: 'pager' },
        el('span', { class: 'muted' }, rows.length ? `Rows ${t.page * PAGE_SIZE + 1}–${t.page * PAGE_SIZE + pageRows.length} of ${rows.length.toLocaleString('en-US')}` : 'No matching rows'),
        el('button', { class: 'btn small', disabled: t.page === 0, onclick: () => { t.page--; draw(); } }, '← Prev'),
        el('button', { class: 'btn small', disabled: t.page >= pages - 1, onclick: () => { t.page++; draw(); } }, 'Next →')));
  };
  wrap.append(
    el('div', { class: 'toolbar' },
      el('input', { type: 'search', class: 'search', placeholder: 'Search all columns…', value: t.search, 'aria-label': 'Search rows', oninput: (e) => { t.search = e.target.value; t.page = 0; draw(); } }),
      el('button', { class: 'btn small', onclick: () => download(`${state.dataset.name}-filtered.csv`, datasetToCSV(state.dataset, indices)) }, '⇩ Export CSV')),
    state.learn && el('p', { class: 'muted small' }, 'Click a column header to sort. Missing values are shown as — and always sort last.'),
    body);
  draw();
  return wrap;
}

// ---------- chart builder ----------

function renderChartTab() {
  const ch = state.chart;
  const c = cols();
  const xCol = c[ch.x];
  const yCol = ch.y == null ? null : c[ch.y];
  const suggestion = suggestChart(xCol, yCol);
  const type = ch.type === 'auto' ? suggestion.type : ch.type;
  const data = type ? buildChartData(state.dataset, indices, { type, x: ch.x, y: ch.y, agg: ch.agg }) : { error: suggestion.reason };
  const usesAgg = yCol?.type === 'number' && (type === 'bar' || type === 'line');
  const colOptions = c.map((col, i) => ({ value: i, label: `${TYPE_ICONS[col.type]}  ${col.name}` }));

  const controls = el('div', { class: 'chart-controls card' },
    field('X axis', select(colOptions, ch.x, (v) => { ch.x = +v; render(); })),
    el('button', { class: 'icon-btn swap', type: 'button', title: 'Swap X and Y', disabled: ch.y == null, onclick: () => { [ch.x, ch.y] = [ch.y, ch.x]; render(); } }, '⇄'),
    field('Y axis (optional)', select([{ value: '', label: '— none —' }, ...colOptions], ch.y ?? '', (v) => { ch.y = v === '' ? null : +v; render(); })),
    field('Chart type', select([{ value: 'auto', label: `✨ Auto (${CHART_TYPES[suggestion.type]?.label ?? '–'})` }, ...Object.entries(CHART_TYPES).map(([k, v]) => ({ value: k, label: v.label }))], ch.type, (v) => { ch.type = v; render(); })),
    usesAgg && field('Combine values with', select(Object.entries(AGGREGATIONS).filter(([k]) => k !== 'distinct').map(([k, v]) => ({ value: k, label: v.label })), ch.agg, (v) => { ch.agg = v; render(); })));

  return el('div', { class: 'chart-view' },
    controls,
    el('div', { class: 'card chart-card' },
      ch.type === 'auto' && type && el('p', { class: 'why' }, el('strong', {}, 'Why this chart? '), suggestion.reason),
      data.error ? el('div', { class: 'empty' }, data.error) : [el('div', { class: 'chart-wrap' }, renderChart(data)), chartNotes(data)]),
    type && learnTip(CHART_TYPES[type].term));
}

function field(label, control) {
  return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), control);
}

function chartNotes(data) {
  const notes = [];
  if (data.type === 'scatter') {
    if (Number.isFinite(data.r)) {
      notes.push([`Correlation `, termLink('correlation', 'r'), ` = ${data.r.toFixed(2)}: a ${correlationStrength(data.r)} ${data.r >= 0 ? 'positive' : 'negative'} relationship.`]);
    }
    if (data.regression) {
      const { slope, r2 } = data.regression;
      notes.push([`On average, each +1 in ${data.xLabel} goes with ${slope >= 0 ? '+' : ''}${formatNumber(slope)} in ${data.yLabel}. The `, termLink('trend', 'trend line'), ` explains ${Math.round(r2 * 100)}% of the variation (R² = ${r2.toFixed(2)}).`]);
    }
    if (data.total > data.points.length) notes.push(`Showing a sample of ${data.points.length.toLocaleString('en-US')} of ${data.total.toLocaleString('en-US')} points.`);
  } else if (data.type === 'histogram') {
    const s = data.stats;
    notes.push(['The dashed lines mark the ', termLink('mean'), ` (${formatNumber(s.mean)}) and `, termLink('median'), ` (${formatNumber(s.median)}).`, Math.abs(s.skew) >= 1 ? ` They differ because the data is ${s.skew > 0 ? 'right' : 'left'}-skewed.` : '']);
  } else if (data.type === 'bar' && data.total > data.bars.length) {
    notes.push(`Showing the top ${data.bars.length} of ${data.total} groups.`);
  } else if (data.type === 'box') {
    notes.push(['Each box spans the middle half of the values (', termLink('quartiles', 'Q1 to Q3'), '); the line inside is the median, and dots are ', termLink('outlier', 'outliers'), '.']);
    if (data.truncated) notes.push('Showing the 15 largest groups.');
  } else if (data.type === 'line') {
    if (data.unit && data.unit !== 'day') notes.push(`Values are combined per ${data.unit}.`);
    if (data.smooth) notes.push(`The orange line is a ${data.window}-point moving average: it smooths out short-term ups and downs so the overall trend is easier to see.`);
  }
  return notes.length ? el('ul', { class: 'chart-notes' }, notes.map((n) => el('li', {}, n))) : null;
}

// ---------- summarize ----------

function renderSummarize() {
  const s = state.summarize;
  const c = cols();
  const byCol = c[s.by];
  const numericOptions = c.map((col, i) => ({ col, i })).filter(({ col }) => col.type === 'number' || col.type === 'boolean');
  const result = groupBy(state.dataset, indices, s);

  const aggRows = s.aggs.map((a, k) => el('div', { class: 'agg-row' },
    select(Object.entries(AGGREGATIONS).map(([fn, v]) => ({ value: fn, label: v.label })), a.fn, (fn) => {
      a.fn = fn;
      if (fn === 'count') a.column = null;
      else if (a.column == null) a.column = AGGREGATIONS[fn].needsNumber ? numericOptions[0]?.i ?? null : 0;
      if (AGGREGATIONS[fn].needsNumber && a.column == null) {
        toast('This summary needs a number column, and this dataset has none.');
        a.fn = 'count';
      }
      render();
    }, { 'aria-label': 'Summary' }),
    a.fn !== 'count' && el('span', { class: 'muted' }, 'of'),
    a.fn !== 'count' && select(
      (AGGREGATIONS[a.fn].needsNumber ? numericOptions : c.map((col, i) => ({ col, i }))).map(({ col, i }) => ({ value: i, label: col.name })),
      a.column, (v) => { a.column = +v; render(); }, { 'aria-label': 'Column to summarise' }),
    s.aggs.length > 1 && el('button', { class: 'icon-btn', 'aria-label': 'Remove summary', onclick: () => { s.aggs.splice(k, 1); render(); } }, '✕')));

  const firstValueCol = result.headers.length > 1 ? 1 : null;
  const bars = firstValueCol && result.rows.map((r) => ({ label: String(r[0]), value: r[firstValueCol] })).filter((b) => Number.isFinite(b.value));

  return el('div', { class: 'summarize-view' },
    el('div', { class: 'card summarize-controls' },
      el('div', { class: 'agg-row' },
        el('span', { class: 'field-label' }, 'Group rows by'),
        select(c.map((col, i) => ({ value: i, label: col.name })), s.by, (v) => { s.by = +v; render(); }, { 'aria-label': 'Group by' }),
        byCol.type === 'date' && select([['day', 'day'], ['month', 'month'], ['year', 'year'], ['weekday', 'day of week']].map(([value, label]) => ({ value, label })), s.dateUnit, (v) => { s.dateUnit = v; render(); }, { 'aria-label': 'Date grouping' })),
      el('div', { class: 'field-label' }, 'and calculate'),
      aggRows,
      el('button', { class: 'btn ghost small', type: 'button', onclick: () => { s.aggs.push(numericOptions.length ? { fn: 'mean', column: numericOptions[0].i } : { fn: 'count', column: null }); render(); } }, '+ Add another summary')),
    learnTip('groupby'),
    el('div', { class: 'summary-grid' },
      el('div', { class: 'card table-scroll' },
        el('table', { class: 'data-table' },
          el('thead', {}, el('tr', {}, result.headers.map((h, j) => el('th', { class: j ? 'num' : '' }, h)))),
          el('tbody', {}, result.rows.slice(0, 500).map((r) => el('tr', {}, r.map((v, j) => el('td', { class: j ? 'num' : '' }, j ? formatNumber(v) : String(v)))))))),
      bars && bars.length > 0 && el('div', { class: 'card chart-card' },
        el('div', { class: 'chart-wrap' }, renderChart({ type: 'bar', xLabel: result.headers[0], valueLabel: result.headers[firstValueCol], bars: bars.slice(0, 30) })))),
    el('div', { class: 'toolbar' },
      el('span', { class: 'muted' }, plural(result.rows.length, 'group')),
      el('button', { class: 'btn small', onclick: () => download(`${state.dataset.name}-summary.csv`, toCSV(result.headers, result.rows)) }, '⇩ Export summary CSV')));
}

// ---------- learn ----------

function renderLearn() {
  return el('div', { class: 'learn-view' },
    el('section', {},
      el('h2', {}, 'Guided lessons'),
      el('p', { class: 'muted' }, 'Each lesson loads practice data and takes you to the right place in Lumora.'),
      el('div', { class: 'lessons' }, LESSONS.map(lessonCard))),
    el('section', {},
      el('h2', {}, 'Glossary'),
      el('div', { class: 'glossary' }, Object.entries(GLOSSARY).map(([, g]) =>
        el('details', { class: 'card' }, el('summary', {}, el('strong', {}, g.term), el('span', { class: 'muted' }, ` · ${g.short}`)), el('p', {}, g.body))))));
}

// ---------- shell ----------

function render() {
  const scrollY = window.scrollY;
  const loaded = !!state.dataset;
  $name.textContent = loaded ? state.dataset.name : '';
  $name.hidden = !loaded;
  document.getElementById('home-btn').hidden = !loaded;
  clear($app).append(loaded ? renderWorkspace() : renderHome());
  if (loaded) window.scrollTo(0, scrollY);
}

document.getElementById('open-btn').addEventListener('click', () => $fileInput.click());
document.getElementById('home-btn').addEventListener('click', () => { state.dataset = null; render(); });
$fileInput.addEventListener('change', () => {
  loadFile($fileInput.files[0]);
  $fileInput.value = '';
});

const $learn = document.getElementById('learn-toggle');
$learn.checked = state.learn;
$learn.addEventListener('change', () => {
  state.learn = $learn.checked;
  store.set('learn', state.learn);
  render();
});

const $theme = document.getElementById('theme-btn');
const applyTheme = (t) => {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
};
applyTheme(store.get('theme', null));
$theme.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  store.set('theme', next);
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dragging');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  loadFile(e.dataTransfer.files[0]);
});
window.addEventListener('paste', (e) => {
  if (state.dataset || e.target.closest?.('input, textarea')) return;
  const text = e.clipboardData?.getData('text');
  if (text && text.includes('\n')) loadText(text, 'pasted data.csv');
});

installTooltip(document.getElementById('tooltip'));

// Expose for debugging and automated tests.
window.lumora = { state, loadText, loadSample };

const params = new URLSearchParams(location.search);
if (params.get('sample')) loadSample(params.get('sample'));
else render();
