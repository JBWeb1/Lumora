import { buildDataset, datasetFromText, TYPES } from './core/infer.js';
import { applyStep, describeStep, duplicateRows, runRecipe } from './core/clean.js';
import { FUNCTIONS, evaluateFormula } from './core/formula.js';
import { testColumns } from './core/significance.js';
import { readXlsx } from './core/xlsx.js';
import { describe, frequencies, histogram, numbers, correlationMatrix, correlationStrength } from './core/stats.js';
import {
  AGGREGATIONS, FILTER_OPS, NO_VALUE_OPS, aggregate, applyFilters, datasetToCSV, formatDate, formatNumber, formatValue,
  groupBy, searchRows, sortIndices, toCSV,
} from './core/transform.js';
import { generateInsights } from './core/insights.js';
import { CHART_TYPES, buildChartData, suggestChart } from './core/chartspec.js';
import { GLOSSARY, LESSONS } from './core/learn.js';
import { SAMPLES, sampleCSV } from './core/samples.js';
import { el, clear, select, download, installTooltip } from './ui/dom.js';
import { renderChart, heatmap, sparkHistogram } from './ui/charts.js';
import { exportChart } from './ui/export.js';
import { initUpdates, watchInstallPrompt, compareVersions } from './ui/updates.js';
import { VERSION, CHANGELOG } from './version.js';
import { exampleQuestions, parseQuestion } from './core/ask.js';
import { canBeTarget, keyDrivers, strengthWord } from './core/drivers.js';
import { deserializeProject, isProject, newProjectId, projectSummary, serializeProject } from './core/project.js';
import { deleteProject, listProjects, loadProject, saveProject } from './ui/storage.js';

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
  original: null, // the data exactly as loaded
  steps: [], // cleaning steps applied on top of it (replayed for undo)
  dataset: null,
  filters: [],
  tab: 'overview',
  learn: store.get('learn', true),
  table: { sort: null, dir: 'asc', page: 0, search: '' },
  chart: { type: 'auto', x: null, y: null, agg: 'mean', color: null },
  clean: {},
  summarize: { by: null, dateUnit: 'month', aggs: [{ fn: 'count', column: null }] },
  addingFilter: null,
  projectId: null, // auto-saved under this id
  report: [], // pinned charts, summaries, answers and notes (column references by name)
  ask: { question: '', parsed: null },
  drivers: { target: null },
};

let indices = [];

const TABS = [
  { id: 'overview', label: 'Overview', icon: '✦' },
  { id: 'table', label: 'Table', icon: '▦' },
  { id: 'chart', label: 'Chart', icon: '∿' },
  { id: 'summarize', label: 'Summarize', icon: 'Σ' },
  { id: 'drivers', label: 'Drivers', icon: '◎' },
  { id: 'clean', label: 'Clean', icon: '✎' },
  { id: 'report', label: 'Report', icon: '❏', count: () => state.report.length },
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
  scheduleSave();
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

function loadDataset(ds) {
  if (!ds.columns.length || !ds.rowCount) throw new Error('No rows found. Is the first line a header row?');
  state.original = ds;
  state.steps = [];
  state.dataset = ds;
  state.clean = {};
  state.addingFilter = null;
  state.projectId = newProjectId();
  state.report = [];
  state.ask = { question: '', parsed: null };
  state.drivers = { target: null };
  store.set('openProject', state.projectId);
  chooseDefaults();
  state.tab = 'overview';
  update();
}

function loadText(text, fileName) {
  try {
    if (/^\s*\{/.test(text)) {
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* not JSON: fall through to the normal loader for a clearer message */
      }
      if (isProject(json)) {
        openProject(json, { imported: true });
        return true;
      }
    }
    loadDataset(datasetFromText(text, fileName));
    return true;
  } catch (err) {
    toast(`Couldn't read ${fileName}: ${err.message}`);
    return false;
  }
}

async function loadExcel(buffer, fileName) {
  const base = fileName.replace(/\.[^.]+$/, '');
  try {
    const sheets = await readXlsx(buffer);
    const open = (sheet) => loadDataset(buildDataset(sheets.length > 1 ? `${base} · ${sheet.name}` : base, sheet.headers, sheet.rows));
    if (sheets.length === 1) {
      open(sheets[0]);
      return;
    }
    openDialog('Choose a sheet',
      el('p', { class: 'muted' }, `${fileName} has ${sheets.length} sheets with data.`),
      el('div', { class: 'sheet-list' }, sheets.map((s) =>
        el('button', { class: 'card sheet', type: 'button', onclick: () => { $dialog.close(); open(s); } },
          el('strong', {}, s.name), el('span', { class: 'muted' }, `${plural(s.rows.length, 'row')} · ${plural(s.headers.length, 'column')}`)))));
  } catch (err) {
    toast(`Couldn't read ${fileName}: ${err.message}`);
  }
}

function loadFile(file) {
  if (!file) return;
  if (file.size > 200 * 1024 * 1024) {
    toast('That file is over 200 MB. Lumora runs in your browser and works best with files under 50 MB.');
    return;
  }
  if (/\.xls$/i.test(file.name)) {
    toast('Old .xls files aren\'t supported. In Excel choose File → Save As → Excel Workbook (.xlsx) or CSV.');
    return;
  }
  const excel = /\.(xlsx|xlsm)$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = () => (excel ? loadExcel(reader.result, file.name) : loadText(String(reader.result), file.name));
  reader.onerror = () => toast(`Couldn't open ${file.name}.`);
  if (excel) reader.readAsArrayBuffer(file);
  else reader.readAsText(file);
}

function loadSample(id) {
  const sample = SAMPLES.find((s) => s.id === id);
  return loadText(sampleCSV(id), `${sample.name}.csv`);
}

function runLesson(lesson) {
  const t = lesson.try;
  if (state.dataset?.name !== SAMPLES.find((s) => s.id === t.sample).name || state.steps.length) loadSample(t.sample);
  else state.filters = [];
  if (t.chart) {
    state.chart = { type: t.chart.type ?? 'auto', x: colIndex(t.chart.x), y: t.chart.y ? colIndex(t.chart.y) : null, agg: 'mean', color: null };
  }
  if (t.summarize) {
    state.summarize = {
      by: colIndex(t.summarize.by),
      dateUnit: 'month',
      aggs: t.summarize.aggs.map((a) => ({ fn: a.fn, column: a.column ? colIndex(a.column) : null })),
    };
  }
  if (t.clean) state.clean = { ...t.clean };
  if (t.drivers) state.drivers = { target: colIndex(t.drivers) };
  state.tab = t.tab;
  if (t.ask) {
    state.ask = { question: t.ask, parsed: parseQuestion(t.ask, state.dataset) };
  }
  update();
  toast(lesson.title.replace(/^\d+\.\s*/, 'Lesson: '), 'info');
}

// ---------- home ----------

function renderHome() {
  const drop = el('button', { class: 'dropzone', type: 'button', onclick: () => $fileInput.click() },
    el('div', { class: 'drop-icon', 'aria-hidden': 'true' }, '⇪'),
    el('div', { class: 'drop-title' }, 'Drop a file here, or click to choose'),
    el('div', { class: 'muted' }, 'Excel, CSV, TSV or JSON. Your data stays on your computer and is never uploaded.'));

  return el('div', { class: 'home' },
    el('section', { class: 'hero' },
      el('img', { class: 'hero-logo', src: 'assets/logo-192.png', alt: 'Lumora logo', width: 96, height: 96 }),
      el('h1', {}, 'Understand your data ', el('span', { class: 'glow' }, 'in seconds')),
      el('p', { class: 'lead' }, 'Lumora reads your spreadsheet, explains what is inside in plain English, and helps you build the right chart, even if you have never studied statistics.'),
      drop),
    recentWorkSection(),
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
       ['3', 'Clean', 'Fix duplicates and missing values, and add calculated columns, with undo.'],
       ['4', 'Answer', 'Filter, group, chart and test whether differences are real, then export.']]
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
    }, el('span', { class: 'tab-icon', 'aria-hidden': 'true' }, t.icon), t.label, t.count?.() ? el('span', { class: 'tab-count' }, t.count()) : null)));

  const views = { overview: renderOverview, table: renderTable, chart: renderChartTab, summarize: renderSummarize, drivers: renderDrivers, clean: renderClean, report: renderReport, learn: renderLearn };
  return el('div', { class: 'workspace' }, nav, !['learn', 'report'].includes(state.tab) && renderFilterBar(), el('div', { class: 'view' }, views[state.tab]()));
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
    state.filters.length > 1 && el('button', { class: 'btn ghost small', type: 'button', onclick: () => { state.filters = []; update(); } }, 'Clear all'),
    state.steps.length > 0 && el('span', { class: 'steps-pill' },
      el('button', { class: 'btn ghost small', type: 'button', onclick: () => { state.tab = 'clean'; render(); } }, `✎ ${plural(state.steps.length, 'cleaning step')}`),
      el('button', { class: 'btn small', type: 'button', title: `Undo: ${describeStep(state.steps.at(-1))} (Ctrl+Z)`, onclick: undo }, '↶ Undo')));
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
    renderAsk(),
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
        ins.action && el('button', { class: 'btn small', type: 'button', onclick: () => showAction(ins.action) }, ins.action.label ?? 'Show me →'),
        ins.term && termLink(ins.term, `What is ${GLOSSARY[ins.term].term.toLowerCase()}?`))));
}

function showAction(action) {
  if (action.tab) {
    state.tab = action.tab;
    render();
    return;
  }
  state.chart = { type: action.type, x: action.x, y: action.y ?? null, agg: 'mean', color: null };
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
        addStep({ op: 'setType', column: col.name, type: t });
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
      el('button', { class: 'btn primary small', onclick: () => { $dialog.close(); state.chart = { type: 'auto', x: index, y: null, agg: 'mean', color: null }; state.tab = 'chart'; render(); } }, 'Open in chart builder'),
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
  const data = type ? buildChartData(state.dataset, indices, { type, x: ch.x, y: ch.y, agg: ch.agg, color: ch.color }) : { error: suggestion.reason };
  const usesAgg = yCol?.type === 'number' && (type === 'bar' || type === 'line');
  const colOptions = c.map((col, i) => ({ value: i, label: `${TYPE_ICONS[col.type]}  ${col.name}` }));

  const controls = el('div', { class: 'chart-controls card' },
    field('X axis', select(colOptions, ch.x, (v) => { ch.x = +v; render(); })),
    el('button', { class: 'icon-btn swap', type: 'button', title: 'Swap X and Y', disabled: ch.y == null, onclick: () => { [ch.x, ch.y] = [ch.y, ch.x]; render(); } }, '⇄'),
    field('Y axis (optional)', select([{ value: '', label: '— none —' }, ...colOptions], ch.y ?? '', (v) => { ch.y = v === '' ? null : +v; render(); })),
    field('Chart type', select([{ value: 'auto', label: `✨ Auto (${CHART_TYPES[suggestion.type]?.label ?? '–'})` }, ...Object.entries(CHART_TYPES).map(([k, v]) => ({ value: k, label: v.label }))], ch.type, (v) => { ch.type = v; render(); })),
    usesAgg && field('Combine values with', select(Object.entries(AGGREGATIONS).filter(([k]) => k !== 'distinct').map(([k, v]) => ({ value: k, label: v.label })), ch.agg, (v) => { ch.agg = v; render(); })),
    type === 'scatter' && field('Color by (optional)', select(
      [{ value: '', label: '— none —' }, ...c.map((col, i) => ({ col, i })).filter(({ col }) => col.type === 'category' || col.type === 'boolean').map(({ col, i }) => ({ value: i, label: col.name }))],
      ch.color ?? '', (v) => { ch.color = v === '' ? null : +v; render(); })));

  const chartEl = data.error ? null : renderChart(data);
  const title = data.error ? '' : [data.yLabel ?? data.valueLabel, data.xLabel ?? data.groupLabel].filter(Boolean).join(' by ');
  return el('div', { class: 'chart-view' },
    controls,
    el('div', { class: 'card chart-card' },
      ch.type === 'auto' && type && el('p', { class: 'why' }, el('strong', {}, 'Why this chart? '), suggestion.reason),
      data.error ? el('div', { class: 'empty' }, data.error) : [
        el('div', { class: 'chart-wrap' }, chartEl),
        chartNotes(data),
        el('div', { class: 'chart-export' },
          el('span', { class: 'muted small' }, 'Download chart:'),
          el('button', { class: 'btn small', type: 'button', onclick: () => exportChart(chartEl, `${state.dataset.name} ${title}`, 'png') }, '⇩ PNG'),
          el('button', { class: 'btn small', type: 'button', onclick: () => exportChart(chartEl, `${state.dataset.name} ${title}`, 'svg') }, '⇩ SVG'),
          el('button', { class: 'btn small primary', type: 'button', onclick: () => pin({ kind: 'chart', title: title || 'Chart', chart: chartRefs(state.chart, type) }) }, '📌 Add to report')),
      ]),
    significanceCard(ch),
    type && learnTip(CHART_TYPES[type].term));
}

function significanceCard(ch) {
  const res = testColumns(state.dataset, indices, ch.x, ch.y);
  if (!res) return null;
  return el('section', { class: `card significance ${res.verdict.level}` },
    el('div', { class: 'sig-head' },
      el('h3', {}, 'Is this real, or just luck?'),
      el('span', { class: 'sig-badge' }, { strong: 'Strong evidence', moderate: 'Some evidence', weak: 'Inconclusive', none: 'No evidence' }[res.verdict.level])),
    el('p', { class: 'sig-headline' }, res.headline),
    el('ul', {}, res.details.map((d) => el('li', {}, d))),
    res.caution && el('p', { class: 'muted small' }, '⚠ ', res.caution),
    el('p', { class: 'muted small' }, 'Method: ', termLink(res.term, res.test), ' · ', termLink('pvalue', 'What is a p-value?')));
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
      el('div', { class: 'toolbar-actions' },
        el('button', { class: 'btn small', onclick: () => download(`${state.dataset.name}-summary.csv`, toCSV(result.headers, result.rows)) }, '⇩ Export summary CSV'),
        el('button', { class: 'btn small primary', type: 'button', onclick: () => pin({ kind: 'summary', title: result.headers.slice(1).join(', ') + ` by ${result.headers[0]}`, summarize: summarizeRefs(state.summarize) }) }, '📌 Add to report'))));
}

// ---------- cleaning steps ----------

/** Column references in the UI are indices; remember them by name so they survive steps. */
function snapshotRefs() {
  const name = (i) => (i == null || i < 0 ? null : cols()[i]?.name ?? null);
  return {
    chart: { x: name(state.chart.x), y: name(state.chart.y), color: name(state.chart.color) },
    by: name(state.summarize.by),
    aggs: state.summarize.aggs.map((a) => ({ ...a, column: name(a.column) })),
    filters: state.filters.map((f) => ({ ...f, column: name(f.column) })),
    sort: name(state.table.sort),
    target: name(state.drivers.target),
  };
}

function restoreRefs(refs, renames) {
  const idx = (n) => {
    if (n == null) return null;
    const i = colIndex(renames[n] ?? n);
    return i < 0 ? null : i;
  };
  state.chart.x = idx(refs.chart.x) ?? 0;
  state.chart.y = idx(refs.chart.y);
  state.chart.color = idx(refs.chart.color);
  state.summarize.by = idx(refs.by) ?? 0;
  state.summarize.aggs = refs.aggs.map((a) => ({ ...a, column: idx(a.column) })).filter((a) => a.fn === 'count' || a.column != null);
  if (!state.summarize.aggs.length) state.summarize.aggs = [{ fn: 'count', column: null }];
  state.filters = refs.filters.map((f) => ({ ...f, column: idx(f.column) })).filter((f) => f.column != null);
  state.table.sort = idx(refs.sort);
  state.drivers.target = idx(refs.target);
}

function setSteps(steps, renames = {}) {
  let ds;
  try {
    ds = runRecipe(state.original, steps);
  } catch (err) {
    toast(err.message);
    return false;
  }
  const refs = snapshotRefs();
  state.steps = steps;
  state.dataset = ds;
  state.addingFilter = null;
  state.ask = { question: state.ask.question, parsed: null };
  restoreRefs(refs, renames);
  update();
  return true;
}

/** Report items refer to columns by name; keep them pointing at a renamed column. */
function renameInReport(from, to) {
  const swap = (v) => (v === from ? to : v);
  const fixFilters = (fs) => fs?.forEach((f) => { f.column = swap(f.column); });
  for (const item of state.report) {
    fixFilters(item.filters);
    if (item.chart) {
      for (const k of ['x', 'y', 'color']) item.chart[k] = swap(item.chart[k]);
      fixFilters(item.chart.filters);
    }
    if (item.summarize) {
      item.summarize.by = swap(item.summarize.by);
      item.summarize.aggs.forEach((a) => { a.column = swap(a.column); });
      fixFilters(item.summarize.filters);
    }
    if (item.value) item.value.column = swap(item.value.column);
    if (item.drivers) {
      item.drivers.target = swap(item.drivers.target);
      fixFilters(item.drivers.filters);
    }
  }
}

function addStep(step) {
  if (step.op === 'keepRows') state.filters = [];
  const renames = step.op === 'rename' ? { [step.column]: step.to } : {};
  // Rename report references first so the re-render already shows them; revert if the step fails.
  if (step.op === 'rename') renameInReport(step.column, step.to);
  if (setSteps([...state.steps, step], renames)) toast(`✓ ${describeStep(step)}`, 'info');
  else if (step.op === 'rename') renameInReport(step.to, step.column);
}

function undo() {
  const last = state.steps.at(-1);
  if (!last) return;
  if (last.op === 'rename') renameInReport(last.to, last.column);
  if (setSteps(state.steps.slice(0, -1), last.op === 'rename' ? { [last.to]: last.column } : {})) toast(`Undid: ${describeStep(last)}`, 'info');
  else if (last.op === 'rename') renameInReport(last.column, last.to);
}

// ---------- clean ----------

function renderClean() {
  const ds = state.dataset;
  const c = cols();
  const f = state.clean;
  const names = c.map((col) => col.name);
  const pick = (key, fallback) => (names.includes(f[key]) ? f[key] : (f[key] = fallback));
  const missingCounts = new Map(c.map((col) => [col.name, col.values.reduce((n, v) => n + (v == null), 0)]));
  const withMissing = names.filter((n) => missingCounts.get(n) > 0);
  const dupCount = duplicateRows(ds).length;

  // Missing values
  const missingCol = pick('missingCol', withMissing[0] ?? names[0]);
  const missingType = c[colIndex(missingCol)].type;
  const methods = [
    ['drop', 'Remove those rows'],
    ...(missingType === 'number' ? [['median', 'Fill with the median'], ['mean', 'Fill with the average']] : []),
    ['mode', 'Fill with the most common value'],
    ['previous', "Fill with the previous row's value"],
    ['value', 'Fill with a value I choose'],
  ];
  if (!methods.some(([m]) => m === f.missingMethod)) f.missingMethod = methods[1][0];
  const missingCard = actionCard('Missing values', 'missing',
    withMissing.length ? `${plural(withMissing.length, 'column')} ${withMissing.length === 1 ? 'has' : 'have'} gaps.` : 'No missing values. Nothing to fix here.',
    el('div', { class: 'form-row' },
      select(names.map((n) => ({ value: n, label: `${n} (${missingCounts.get(n)} missing)` })), missingCol, (v) => { f.missingCol = v; render(); }, { 'aria-label': 'Column with missing values' }),
      select(methods.map(([value, label]) => ({ value, label })), f.missingMethod, (v) => { f.missingMethod = v; render(); }, { 'aria-label': 'What to do' }),
      f.missingMethod === 'value' && el('input', { type: 'text', value: f.fillValue ?? '', placeholder: 'value', 'aria-label': 'Fill value', oninput: (e) => { f.fillValue = e.target.value; } }),
      el('button', {
        class: 'btn primary small', type: 'button', disabled: !missingCounts.get(missingCol),
        onclick: () => addStep(f.missingMethod === 'drop'
          ? { op: 'dropMissing', column: missingCol }
          : { op: 'fillMissing', column: missingCol, method: f.missingMethod, value: f.fillValue }),
      }, 'Apply')),
    withMissing.length > 1 && el('button', { class: 'btn ghost small', type: 'button', onclick: () => addStep({ op: 'dropMissing', column: null }) }, 'Remove every row that has any missing value'));

  // Duplicates
  const dupCard = actionCard('Duplicate rows', 'cleaning',
    dupCount ? `${plural(dupCount, 'row')} ${dupCount === 1 ? 'is an exact copy' : 'are exact copies'} of an earlier row.` : 'No duplicate rows found.',
    el('button', { class: 'btn primary small', type: 'button', disabled: !dupCount, onclick: () => addStep({ op: 'removeDuplicates' }) }, 'Remove duplicates'));

  // Calculated column
  const preview = el('div', { class: 'formula-preview' });
  const formulaInput = el('input', {
    type: 'text', class: 'formula-input', value: f.formula ?? '', placeholder: 'e.g. revenue / customers', spellcheck: 'false', 'aria-label': 'Formula',
    oninput: (e) => { f.formula = e.target.value; drawPreview(); },
  });
  const drawPreview = () => {
    clear(preview);
    if (!f.formula?.trim()) {
      preview.append(el('span', { class: 'muted' }, 'A preview of the first rows appears here as you type.'));
      return;
    }
    try {
      const rows = indices.slice(0, 5);
      const results = evaluateFormula(f.formula, ds, rows);
      preview.append(el('span', { class: 'muted' }, 'Preview: '), ...results.map((v, k) => el('span', { class: 'preview-value', title: `Row ${rows[k] + 1}` }, v == null ? '—' : typeof v === 'number' ? formatNumber(v) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v))));
    } catch (err) {
      preview.append(el('span', { class: 'formula-error' }, err.message));
    }
  };
  drawPreview();
  const insert = (text) => {
    const start = formulaInput.selectionStart ?? formulaInput.value.length;
    const end = formulaInput.selectionEnd ?? start;
    formulaInput.value = formulaInput.value.slice(0, start) + text + formulaInput.value.slice(end);
    formulaInput.focus();
    formulaInput.setSelectionRange(start + text.length, start + text.length);
    f.formula = formulaInput.value;
    drawPreview();
  };
  const formulaCard = actionCard('New calculated column', 'formula', 'Combine columns with a formula. Click a column name to insert it.',
    el('div', { class: 'form-row' },
      el('input', { type: 'text', value: f.formulaName ?? '', placeholder: 'New column name', 'aria-label': 'New column name', oninput: (e) => { f.formulaName = e.target.value; } }),
      el('span', { class: 'muted' }, '=')),
    formulaInput,
    preview,
    el('div', { class: 'column-chips' }, c.map((col) => el('button', { class: 'col-chip', type: 'button', onclick: () => insert(/^[\p{L}_][\p{L}\p{N}_]*$/u.test(col.name) ? col.name : `[${col.name}]`) }, el('span', { class: `type-badge t-${col.type}` }, TYPE_ICONS[col.type]), col.name))),
    el('details', { class: 'functions' },
      el('summary', {}, 'Functions and examples'),
      el('p', { class: 'muted small' }, 'Operators: + − * / ^ (power), comparisons = != < > <= >=, and / or / not, & joins text. Text goes in "quotes".'),
      el('ul', {}, Object.entries(FUNCTIONS).map(([name, fn]) => el('li', {}, el('button', { class: 'fn-insert', type: 'button', onclick: () => insert(`${name}(`) }, `${name}(${fn.args})`), ' ', el('span', { class: 'muted' }, fn.help))))),
    el('button', { class: 'btn primary small', type: 'button', onclick: () => addStep({ op: 'formula', name: f.formulaName, formula: f.formula }) }, 'Add column'));

  // Rename / delete
  const renameCol = pick('renameCol', names[0]);
  const renameCard = actionCard('Rename or delete a column', null, null,
    el('div', { class: 'form-row' },
      select(names.map((n) => ({ value: n, label: n })), renameCol, (v) => { f.renameCol = v; f.renameTo = ''; render(); }, { 'aria-label': 'Column' }),
      el('input', { type: 'text', value: f.renameTo ?? '', placeholder: 'New name', 'aria-label': 'New name', oninput: (e) => { f.renameTo = e.target.value; } }),
      el('button', { class: 'btn primary small', type: 'button', onclick: () => { addStep({ op: 'rename', column: renameCol, to: f.renameTo }); f.renameTo = ''; } }, 'Rename'),
      el('button', { class: 'btn danger small', type: 'button', onclick: () => addStep({ op: 'delete', column: renameCol }) }, 'Delete column')));

  // Tidy text
  const textNames = c.filter((col) => col.type === 'category' || col.type === 'text').map((col) => col.name);
  const textCol = textNames.length ? pick('textCol', textNames[0]) : null;
  const distinct = textCol ? new Set(c[colIndex(textCol)].values.filter((v) => v != null)).size : 0;
  const textCard = textNames.length > 0 && actionCard('Tidy text', null,
    `Inconsistent spelling such as "NY", "ny" and " NY " splits one group into several. ${textCol} has ${plural(distinct, 'distinct value')}.`,
    el('div', { class: 'form-row' },
      select(textNames.map((n) => ({ value: n, label: n })), textCol, (v) => { f.textCol = v; render(); }, { 'aria-label': 'Text column' }),
      select([['trim', 'Remove extra spaces'], ['lower', 'lowercase'], ['upper', 'UPPERCASE'], ['title', 'Title Case']].map(([value, label]) => ({ value, label })), f.textOp ?? 'trim', (v) => { f.textOp = v; }, { 'aria-label': 'Text change' }),
      el('button', { class: 'btn primary small', type: 'button', onclick: () => addStep({ op: 'text', column: textCol, transform: f.textOp ?? 'trim' }) }, 'Apply')));

  // Keep filtered rows
  const keepCard = actionCard('Keep only filtered rows', 'filter',
    state.filters.length
      ? `Make your current filters permanent: keep ${plural(indices.length, 'row')} and remove the other ${(ds.rowCount - indices.length).toLocaleString('en-US')}.`
      : 'Add a filter above, then make it permanent here to remove the rows you don’t need.',
    el('button', {
      class: 'btn primary small', type: 'button', disabled: !state.filters.length,
      onclick: () => addStep({ op: 'keepRows', filters: state.filters.map((x) => ({ op: x.op, value: x.value, column: cols()[x.column].name })) }),
    }, 'Keep filtered rows'));

  const history = el('aside', { class: 'card history' },
    el('h3', {}, 'Steps'),
    el('p', { class: 'muted small' }, `Original: ${plural(state.original.rowCount, 'row')} × ${plural(state.original.columns.length, 'column')}. Your file is never changed.`),
    state.steps.length
      ? el('ol', { class: 'step-list' }, state.steps.map((s) => el('li', {}, describeStep(s))))
      : el('p', { class: 'muted' }, 'No changes yet. Each action you apply appears here.'),
    el('p', { class: 'small' }, `Now: ${plural(ds.rowCount, 'row')} × ${plural(c.length, 'column')}`),
    el('div', { class: 'history-actions' },
      el('button', { class: 'btn small', type: 'button', disabled: !state.steps.length, title: 'Ctrl+Z', onclick: undo }, '↶ Undo last'),
      el('button', { class: 'btn ghost small', type: 'button', disabled: !state.steps.length, onclick: () => { if (confirm('Remove all cleaning steps and go back to the original data?')) setSteps([]); } }, 'Start over'),
      el('button', { class: 'btn small', type: 'button', onclick: () => download(`${ds.name}-clean.csv`, datasetToCSV(ds, [...Array(ds.rowCount).keys()])) }, '⇩ Export cleaned CSV')));

  return el('div', { class: 'clean-view' },
    el('div', { class: 'clean-actions' }, learnTip('cleaning'), dupCard, missingCard, formulaCard, textCard, renameCard, keepCard),
    history);
}

function actionCard(title, term, description, ...body) {
  return el('section', { class: 'card action-card' },
    el('h3', {}, term ? termLink(term, title) : title),
    description && el('p', { class: 'muted' }, description),
    body);
}

// ---------- references by name (survive cleaning steps, saving and reloading) ----------

const nameOf = (i) => (i == null || i < 0 ? null : cols()[i]?.name ?? null);
const idxOf = (name) => {
  if (name == null) return null;
  const i = colIndex(name);
  return i < 0 ? null : i;
};
const filterRefs = (filters) => filters.map((f) => ({ ...f, column: nameOf(f.column) }));
/** Resolve named filters; reports columns that no longer exist instead of silently dropping them. */
function resolveFilters(refs = []) {
  const missing = refs.filter((f) => idxOf(f.column) == null).map((f) => f.column);
  return { filters: refs.filter((f) => idxOf(f.column) != null).map((f) => ({ ...f, column: idxOf(f.column) })), missing };
}
const chartRefs = (ch, type) => ({ type: type ?? ch.type, x: nameOf(ch.x), y: nameOf(ch.y), agg: ch.agg, color: nameOf(ch.color), filters: filterRefs(state.filters) });
const summarizeRefs = (s) => ({ by: nameOf(s.by), dateUnit: s.dateUnit, aggs: s.aggs.map((a) => ({ fn: a.fn, column: nameOf(a.column) })), sort: s.sort ?? null, limit: s.limit ?? null, filters: filterRefs(state.filters) });

function viewByNames() {
  return {
    tab: state.tab,
    filters: filterRefs(state.filters),
    chart: chartRefs(state.chart),
    summarize: summarizeRefs(state.summarize),
    driversTarget: nameOf(state.drivers.target),
    question: state.ask.question,
  };
}

function restoreView(view = {}) {
  if (view.filters) state.filters = resolveFilters(view.filters).filters;
  if (view.chart) state.chart = { type: view.chart.type ?? 'auto', x: idxOf(view.chart.x) ?? 0, y: idxOf(view.chart.y), agg: view.chart.agg ?? 'mean', color: idxOf(view.chart.color) };
  if (view.summarize?.by) {
    state.summarize = {
      by: idxOf(view.summarize.by) ?? 0,
      dateUnit: view.summarize.dateUnit ?? 'month',
      aggs: (view.summarize.aggs ?? []).map((a) => ({ fn: a.fn, column: idxOf(a.column) })).filter((a) => a.fn === 'count' || a.column != null),
    };
    if (!state.summarize.aggs.length) state.summarize.aggs = [{ fn: 'count', column: null }];
  }
  state.drivers = { target: idxOf(view.driversTarget) };
  state.ask = { question: view.question ?? '', parsed: null };
  if (TABS.some((t) => t.id === view.tab)) state.tab = view.tab;
}

// ---------- saving ----------

let saveTimer = null;

function currentProject() {
  return serializeProject({ id: state.projectId, original: state.original, steps: state.steps, view: viewByNames(), report: state.report, appVersion: VERSION });
}

function scheduleSave() {
  if (!state.dataset || !state.projectId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}

async function saveNow() {
  clearTimeout(saveTimer);
  if (!state.dataset || !state.projectId) return;
  try {
    await saveProject(currentProject());
  } catch {
    /* storage full or unavailable: the app keeps working; "Save project" still downloads a file */
  }
}

function openProject(json, { imported = false } = {}) {
  const p = deserializeProject(json);
  state.original = p.original;
  state.steps = p.steps;
  state.dataset = p.dataset;
  state.projectId = imported ? newProjectId() : p.id ?? newProjectId();
  state.report = p.report;
  state.clean = {};
  state.addingFilter = null;
  chooseDefaults();
  state.tab = 'overview';
  restoreView(p.view);
  store.set('openProject', state.projectId);
  update();
  if (p.skippedSteps) toast(`${plural(p.skippedSteps, 'cleaning step')} no longer applied and ${p.skippedSteps === 1 ? 'was' : 'were'} skipped.`);
  else if (imported) toast(`Opened project "${state.original.name}".`, 'info');
}

function saveProjectFile() {
  const name = state.original.name.replace(/[^\w\- ]+/g, '').trim() || 'project';
  download(`${name}.lumora`, JSON.stringify(currentProject()), 'application/json');
  toast('Project file downloaded. Open it in Lumora any time to continue.', 'info');
}

function timeAgo(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return formatDate(Date.parse(iso));
}

/** "Recent work" on the start screen; filled in once storage answers. */
function recentWorkSection() {
  const section = el('section', { class: 'recent', hidden: true });
  listProjects().then((projects) => {
    if (!projects.length) return;
    section.hidden = false;
    section.append(
      el('h2', {}, 'Continue where you left off'),
      el('div', { class: 'recent-list' }, projects.slice(0, 6).map((json) => {
        const p = projectSummary(json);
        const card = el('div', { class: 'card recent-item' },
          el('button', { class: 'recent-open', type: 'button', onclick: () => openProject(json) },
            el('strong', {}, p.name),
            el('span', { class: 'muted small' }, [plural(p.rowCount, 'row'), p.steps && plural(p.steps, 'step'), p.reportItems && plural(p.reportItems, 'report item'), timeAgo(p.savedAt)].filter(Boolean).join(' · '))),
          el('button', {
            class: 'icon-btn', type: 'button', 'aria-label': `Forget ${p.name}`, title: 'Remove from this list',
            onclick: async () => {
              await deleteProject(p.id).catch(() => {});
              card.remove();
              if (!section.querySelector('.recent-item')) section.hidden = true;
            },
          }, '✕'));
        return card;
      })));
  });
  return section;
}

// ---------- ask ----------

function answerQuestion(question) {
  state.ask = { question, parsed: parseQuestion(question, state.dataset) };
  render();
  scheduleSave();
}

function renderAsk() {
  const a = state.ask;
  const input = el('input', { type: 'search', class: 'ask-input', value: a.question, placeholder: 'Ask a question, e.g. "which weekday has the most customers"', 'aria-label': 'Ask a question about your data', autocomplete: 'off' });
  const examples = exampleQuestions(state.dataset).slice(0, 4);
  return el('section', { class: 'card ask' },
    el('form', { class: 'ask-form', onsubmit: (e) => { e.preventDefault(); answerQuestion(input.value); } },
      el('span', { class: 'ask-icon', 'aria-hidden': 'true' }, '✦'),
      input,
      el('button', { class: 'btn primary', type: 'submit' }, 'Ask')),
    a.parsed ? renderAnswer(a.parsed) : el('div', { class: 'ask-examples' },
      el('span', { class: 'muted small' }, 'Try:'),
      examples.map((q) => el('button', { class: 'example-chip', type: 'button', onclick: () => answerQuestion(q) }, q)),
      el('span', { class: 'muted small kbd-hint' }, 'Press / to ask from anywhere')));
}

/** Compute a summary spec ({ by, dateUnit, aggs, sort, limit }) on some rows. */
function runSummary(spec, rows) {
  const result = groupBy(state.dataset, rows, spec);
  if (spec.sort && result.headers.length > 1) {
    const dir = spec.sort === 'asc' ? 1 : -1;
    result.rows.sort((r1, r2) => {
      const a = r1[1];
      const b = r2[1];
      // Missing values last regardless of direction
      if (a == null || b == null) return (a == null) - (b == null);
      return (a - b) * dir;
    });
  }
  return result;
}

const AGG_WORD = { mean: 'average', sum: 'total', median: 'median', min: 'lowest', max: 'highest', count: 'number of rows' };

function renderAnswer(parsed) {
  if (parsed.error) {
    return el('div', { class: 'answer error' },
      el('p', {}, parsed.error, ' Try one of these:'),
      el('div', { class: 'ask-examples' }, parsed.suggestions.map((q) => el('button', { class: 'example-chip', type: 'button', onclick: () => answerQuestion(q) }, q))));
  }
  const c = cols();
  const rows = applyFilters(state.dataset, [...state.filters, ...parsed.filters]);
  const r = parsed.result;
  const understood = el('p', { class: 'understood' }, el('span', { class: 'muted' }, 'Understood as: '), parsed.understood,
    state.filters.length ? el('span', { class: 'muted' }, ` (plus your ${plural(state.filters.length, 'active filter')})`) : '');
  const adoptFilters = () => {
    for (const f of parsed.filters) if (!state.filters.some((g) => g.column === f.column && g.op === f.op && String(g.value) === String(f.value))) state.filters.push({ ...f });
  };
  const actions = [];
  let body;

  if (!rows.length) {
    body = el('p', { class: 'answer-headline' }, 'No rows match those conditions.');
  } else if (r.type === 'value') {
    const v = r.fn === 'count' ? rows.length : aggregate(rows.map((i) => c[r.column].values[i]), r.fn);
    body = el('p', { class: 'answer-headline' }, r.fn === 'count'
      ? [el('strong', {}, rows.length.toLocaleString('en-US')), ` ${rows.length === 1 ? 'row matches' : 'rows match'}`, rows.length !== state.dataset.rowCount ? ` (out of ${state.dataset.rowCount.toLocaleString('en-US')}).` : '.']
      : [`The ${AGG_WORD[r.fn]} ${c[r.column].name} is `, el('strong', {}, formatNumber(v)), ` (from ${plural(rows.length, 'row')}).`]);
    actions.push(['📌 Add to report', () => pin({ kind: 'value', title: parsed.understood, value: { fn: r.fn, column: nameOf(r.column) }, filters: filterRefs([...state.filters, ...parsed.filters]) })]);
  } else if (r.type === 'summary') {
    const spec = { by: r.by, dateUnit: r.dateUnit ?? 'month', aggs: [{ fn: r.fn, column: r.column }], sort: r.sort, limit: r.limit };
    const result = runSummary(spec, rows);
    const top = result.rows[0];
    const valueName = r.fn === 'count' ? 'number of rows' : `${AGG_WORD[r.fn]} ${c[r.column].name}`;
    const shown = r.limit ? result.rows.slice(0, Math.max(r.limit, 5)) : result.rows.slice(0, 12);
    body = [
      r.sort && top && el('p', { class: 'answer-headline' }, el('strong', {}, String(top[0])), ` has the ${r.sort === 'desc' ? 'highest' : 'lowest'} ${valueName}: `, el('strong', {}, formatNumber(top[1])), '.'),
      el('div', { class: 'answer-grid' },
        el('div', { class: 'scroll-x' }, el('table', { class: 'data-table compact' },
          el('thead', {}, el('tr', {}, result.headers.map((h, j) => el('th', { class: j ? 'num' : '' }, h)))),
          el('tbody', {}, shown.map((row, k) => el('tr', { class: r.limit && k < r.limit ? 'highlight' : '' }, row.map((v, j) => el('td', { class: j ? 'num' : '' }, j ? formatNumber(v) : String(v)))))))),
        el('div', { class: 'chart-wrap' }, renderChart({ type: 'bar', xLabel: result.headers[0], valueLabel: result.headers[1], bars: result.rows.slice(0, 15).map((row) => ({ label: String(row[0]), value: row[1] })).filter((b) => Number.isFinite(b.value)) }))),
      result.rows.length > shown.length && el('p', { class: 'muted small' }, `Showing ${shown.length} of ${result.rows.length} groups.`),
    ];
    actions.push(['Open in Summarize', () => { adoptFilters(); state.summarize = { by: r.by, dateUnit: r.dateUnit ?? 'month', aggs: [{ fn: r.fn, column: r.column }] }; state.tab = 'summarize'; update(); }]);
    actions.push(['📌 Add to report', () => pin({ kind: 'summary', title: parsed.understood, summarize: { by: nameOf(r.by), dateUnit: r.dateUnit ?? 'month', aggs: [{ fn: r.fn, column: nameOf(r.column) }], sort: r.sort, limit: r.limit, filters: filterRefs([...state.filters, ...parsed.filters]) } })]);
  } else if (r.type === 'chart') {
    const data = buildChartData(state.dataset, rows, { ...r.chart, agg: 'mean' });
    body = data.error ? el('p', {}, data.error) : [el('div', { class: 'chart-wrap' }, renderChart(data)), chartNotes(data)];
    actions.push(['Open in Chart builder', () => { adoptFilters(); state.chart = { type: r.chart.type, x: r.chart.x, y: r.chart.y, agg: 'mean', color: null }; state.tab = 'chart'; update(); }]);
    actions.push(['📌 Add to report', () => pin({ kind: 'chart', title: parsed.understood, chart: { type: r.chart.type, x: nameOf(r.chart.x), y: nameOf(r.chart.y), agg: 'mean', color: null, filters: filterRefs([...state.filters, ...parsed.filters]) } })]);
  } else if (r.type === 'drivers') {
    const list = keyDrivers(state.dataset, rows, r.target).slice(0, 3);
    body = list.length
      ? el('ol', { class: 'answer-list' }, list.map((d) => el('li', {}, el('strong', {}, d.column), ` (${strengthWord(d.strength)}): `, d.sentence)))
      : el('p', {}, 'No other columns could be compared with this one.');
    actions.push(['See all drivers', () => { adoptFilters(); state.drivers = { target: r.target }; state.tab = 'drivers'; update(); }]);
  }

  return el('div', { class: 'answer' },
    understood,
    body,
    el('div', { class: 'answer-actions' },
      actions.map(([label, fn]) => el('button', { class: 'btn small', type: 'button', onclick: fn }, label)),
      el('button', { class: 'btn ghost small', type: 'button', onclick: () => { state.ask = { question: '', parsed: null }; render(); } }, 'Clear')),
    state.learn && el('p', { class: 'muted small' }, 'Lumora matches your words to column names and common phrases ("average", "by", "which … highest", "over time"). Check the "Understood as" line to make sure it read your question correctly.'));
}

// ---------- drivers ----------

function renderDrivers() {
  const c = cols();
  const targets = c.map((col, i) => ({ col, i })).filter(({ col }) => canBeTarget(col));
  if (!targets.length) return el('div', { class: 'card empty' }, 'Key drivers needs a number column, or a category with up to 10 values, to explain.');
  if (state.drivers.target == null || !canBeTarget(c[state.drivers.target])) {
    const nums = targets.filter(({ col }) => col.type === 'number');
    state.drivers.target = (nums[nums.length - 1] ?? targets[0]).i;
  }
  const t = state.drivers.target;
  const list = keyDrivers(state.dataset, indices, t);
  const max = Math.max(0.0001, ...list.map((d) => d.strength));

  return el('div', { class: 'drivers-view' },
    el('div', { class: 'card drivers-controls' },
      el('label', { class: 'drivers-question' },
        el('span', {}, 'What is most related to'),
        select(targets.map(({ col, i }) => ({ value: i, label: col.name })), t, (v) => { state.drivers.target = +v; update(); }, { 'aria-label': 'Column to explain' }),
        el('span', {}, '?')),
      el('button', { class: 'btn small primary', type: 'button', onclick: () => pin({ kind: 'drivers', title: `What is related to ${c[t].name}`, drivers: { target: c[t].name, filters: filterRefs(state.filters) } }) }, '📌 Add to report')),
    learnTip('drivers'),
    list.length ? el('ol', { class: 'driver-list' }, list.map((d) => el('li', { class: 'card driver' },
      el('div', { class: 'driver-head' },
        el('strong', { class: 'driver-name' }, d.column),
        el('span', { class: 'driver-bar', 'aria-hidden': 'true' }, el('span', { style: { width: `${Math.max(2, (d.strength / max) * 100)}%` } })),
        el('span', { class: `driver-strength s-${strengthWord(d.strength).replace(' ', '-')}` }, `${strengthWord(d.strength)} · ${Math.round(d.strength * 100)}%`)),
      el('p', {}, d.sentence),
      el('div', { class: 'driver-foot' },
        d.p >= 0.05 && el('span', { class: 'pill warn', title: 'p ≥ 0.05' }, 'could be chance'),
        el('button', { class: 'btn ghost small', type: 'button', onclick: () => { state.chart = { type: 'auto', x: d.index, y: t, agg: 'mean', color: null }; state.tab = 'chart'; render(); } }, 'Show chart →')))))
      : el('div', { class: 'card empty' }, 'No other columns could be compared with this one.'),
    el('p', { class: 'muted small' }, '⚠ "Related" does not mean "causes". Two columns can move together because a third thing drives both, or because one is calculated from the other.'));
}

// ---------- report ----------

function pin(item) {
  state.report.push({ id: newProjectId().replace('p-', 'r-'), note: '', filters: filterRefs(state.filters), ...item });
  toast(`Added to report (${plural(state.report.length, 'item')}).`, 'info');
  render();
  scheduleSave();
}

function renderReportItem(item) {
  const missingCols = (names) => names.filter((n) => n != null && idxOf(n) == null);
  const { filters, missing: missingFilterCols } = resolveFilters(item.filters ?? item.chart?.filters ?? item.summarize?.filters ?? item.drivers?.filters);
  const rows = applyFilters(state.dataset, filters);
  const c = cols();
  let missing = [...missingFilterCols];
  let content = null;

  if (item.kind === 'chart') {
    const ch = item.chart;
    missing = missing.concat(missingCols([ch.x, ch.y, ch.color]));
    if (!missing.length) {
      const x = idxOf(ch.x);
      const y = idxOf(ch.y);
      const type = ch.type === 'auto' ? suggestChart(c[x], y == null ? null : c[y]).type : ch.type;
      const data = buildChartData(state.dataset, rows, { type, x, y, agg: ch.agg, color: idxOf(ch.color) });
      content = data.error ? el('p', { class: 'muted' }, data.error) : [el('div', { class: 'chart-wrap' }, renderChart(data)), chartNotes(data)];
    }
  } else if (item.kind === 'summary') {
    const s = item.summarize;
    missing = missing.concat(missingCols([s.by, ...s.aggs.map((a) => a.column)]));
    if (!missing.length) {
      const result = runSummary({ by: idxOf(s.by), dateUnit: s.dateUnit, aggs: s.aggs.map((a) => ({ fn: a.fn, column: idxOf(a.column) })), sort: s.sort }, rows);
      const shown = result.rows.slice(0, s.limit ? Math.max(s.limit, 5) : 25);
      content = el('div', { class: 'answer-grid' },
        el('div', { class: 'scroll-x' }, el('table', { class: 'data-table compact' },
          el('thead', {}, el('tr', {}, result.headers.map((h, j) => el('th', { class: j ? 'num' : '' }, h)))),
          el('tbody', {}, shown.map((row) => el('tr', {}, row.map((v, j) => el('td', { class: j ? 'num' : '' }, j ? formatNumber(v) : String(v)))))))),
        result.headers.length > 1 && el('div', { class: 'chart-wrap' }, renderChart({ type: 'bar', xLabel: result.headers[0], valueLabel: result.headers[1], bars: result.rows.slice(0, 15).map((row) => ({ label: String(row[0]), value: row[1] })).filter((b) => Number.isFinite(b.value)) })));
    }
  } else if (item.kind === 'value') {
    missing = missing.concat(missingCols([item.value.column]));
    if (!missing.length) {
      const v = item.value.fn === 'count' ? rows.length : aggregate(rows.map((i) => c[idxOf(item.value.column)].values[i]), item.value.fn);
      content = el('p', { class: 'report-value' }, formatNumber(v), el('span', { class: 'muted small' }, ` from ${plural(rows.length, 'row')}`));
    }
  } else if (item.kind === 'drivers') {
    missing = missing.concat(missingCols([item.drivers.target]));
    if (!missing.length) {
      const list = keyDrivers(state.dataset, rows, idxOf(item.drivers.target)).slice(0, 5);
      content = el('ol', { class: 'answer-list' }, list.map((d) => el('li', {}, el('strong', {}, d.column), ` (${strengthWord(d.strength)}): `, d.sentence)));
    }
  }

  const autosize = (ta) => {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
  };
  const note = el('textarea', {
    class: 'report-note', rows: item.kind === 'text' ? 4 : 2, placeholder: item.kind === 'text' ? 'Write your text here…' : 'Add a note: what does this show? (optional)',
    'aria-label': 'Note', oninput: (e) => { item.note = e.target.value; autosize(e.target); scheduleSave(); },
  });
  note.value = item.note ?? '';
  requestAnimationFrame(() => autosize(note));
  const pos = state.report.indexOf(item);
  const move = (d) => {
    state.report.splice(pos, 1);
    state.report.splice(pos + d, 0, item);
    render();
    scheduleSave();
  };
  return el('article', { class: `card report-item kind-${item.kind}` },
    el('div', { class: 'report-item-head' },
      el('input', { class: 'report-title', type: 'text', value: item.title ?? '', 'aria-label': 'Title', placeholder: 'Title', oninput: (e) => { item.title = e.target.value; scheduleSave(); } }),
      el('div', { class: 'report-item-actions' },
        el('button', { class: 'icon-btn', type: 'button', title: 'Move up', disabled: pos === 0, onclick: () => move(-1) }, '↑'),
        el('button', { class: 'icon-btn', type: 'button', title: 'Move down', disabled: pos === state.report.length - 1, onclick: () => move(1) }, '↓'),
        el('button', { class: 'icon-btn', type: 'button', title: 'Remove from report', onclick: () => { state.report.splice(pos, 1); render(); scheduleSave(); } }, '✕'))),
    filters.length > 0 && el('p', { class: 'muted small' }, `Filtered: ${filters.map((f) => `${c[f.column].name} ${f.op}${f.value != null && f.value !== '' ? ` ${f.value}` : ''}`).join(' and ')}`),
    missing.length > 0 && el('p', { class: 'pill warn' }, `Column ${[...new Set(missing)].join(', ')} no longer exists, so this item can't be shown.`),
    content,
    note);
}

function renderReport() {
  return el('div', { class: 'report-view' },
    el('div', { class: 'report-toolbar' },
      el('div', {},
        el('h2', { class: 'report-heading' }, `${state.dataset.name}: report`),
        el('p', { class: 'muted small report-meta' }, `${plural(state.dataset.rowCount, 'row')} · ${formatDate(Date.now())}${state.steps.length ? ` · ${plural(state.steps.length, 'cleaning step')}` : ''}`)),
      el('div', { class: 'report-actions' },
        el('button', { class: 'btn small', type: 'button', onclick: () => pin({ kind: 'text', title: 'Notes' }) }, '+ Add text'),
        el('button', { class: 'btn small primary', type: 'button', disabled: !state.report.length, onclick: () => window.print() }, '🖨 Print / Save as PDF'))),
    state.report.length
      ? state.report.map(renderReportItem)
      : el('div', { class: 'card empty report-empty' },
        el('p', {}, el('strong', {}, 'Your report is empty.')),
        el('p', { class: 'muted' }, 'Use 📌 Add to report on a chart, summary, answer or key-drivers list. Everything stays live: if you clean the data or open new data with the same columns, the report updates.'),
        el('button', { class: 'btn small', type: 'button', onclick: () => { state.tab = 'chart'; render(); } }, 'Go to Chart builder')),
    learnTip('report'));
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
  document.getElementById('save-btn').hidden = !loaded;
  clear($app).append(loaded ? renderWorkspace() : renderHome());
  if (loaded) window.scrollTo(0, scrollY);
}

document.getElementById('open-btn').addEventListener('click', () => $fileInput.click());
document.getElementById('save-btn').addEventListener('click', saveProjectFile);
document.getElementById('home-btn').addEventListener('click', async () => {
  await saveNow();
  state.dataset = null;
  store.set('openProject', null);
  // Back on the start screen nothing can be lost, so a waiting update installs now.
  if (pendingUpdate) pendingUpdate();
  else render();
});
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

window.addEventListener('keydown', (e) => {
  if (e.key === '/' && state.dataset && !e.target.closest?.('input, textarea, select')) {
    e.preventDefault();
    if (state.tab !== 'overview') {
      state.tab = 'overview';
      render();
    }
    document.querySelector('.ask-input')?.focus();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && state.dataset && state.steps.length && !e.target.closest?.('input, textarea, select')) {
    e.preventDefault();
    undo();
  }
});

installTooltip(document.getElementById('tooltip'));

// ---------- self-updating ----------

const $footer = document.getElementById('app-footer');
const $updateBar = document.getElementById('update-bar');
let updates = null;
let pendingUpdate = null;
let installApp = null;

function renderFooter() {
  clear($footer).append(...[
    el('span', {}, `Lumora v${VERSION}`),
    el('button', { class: 'link-btn', type: 'button', onclick: () => showWhatsNew() }, "What's new"),
    updates && el('button', { class: 'link-btn', type: 'button', onclick: checkForUpdates }, 'Check for updates'),
    installApp && el('button', { class: 'link-btn', type: 'button', onclick: () => installApp() }, '⇩ Install app'),
    el('span', { class: 'muted' }, 'Your data never leaves this device.'),
  ].filter(Boolean));
}

function showWhatsNew(since) {
  const entries = since ? CHANGELOG.filter((c) => compareVersions(c.version, since) > 0) : CHANGELOG;
  openDialog(since ? `Lumora updated to v${VERSION}` : "What's new in Lumora",
    entries.map((c) => el('section', { class: 'release' },
      el('h3', {}, `v${c.version}`, el('span', { class: 'muted small' }, ` · ${c.date}`)),
      el('ul', {}, c.items.map((item) => el('li', {}, item))))));
}

async function checkForUpdates() {
  toast('Checking for updates…', 'info');
  try {
    const result = await updates.check();
    if (result === 'latest') toast(`You have the latest version (v${VERSION}).`, 'info');
    else toast('Downloading the new version…', 'info');
  } catch {
    toast("Couldn't check for updates. Are you offline?");
  }
}

function showUpdateBar() {
  clear($updateBar).append(
    el('span', {}, el('strong', {}, 'A new version of Lumora is ready.'), ' Your work is saved and reopens right after updating.'),
    el('button', {
      class: 'btn primary small', type: 'button',
      onclick: async () => {
        // Work is auto-saved and reopens after the reload.
        await saveNow();
        pendingUpdate();
      },
    }, 'Update now'),
    el('button', { class: 'btn ghost small', type: 'button', onclick: () => { $updateBar.hidden = true; } }, 'Later'));
  $updateBar.hidden = false;
}

// Runs in the background so it never delays the first screen.
initUpdates({
  onReady(apply) {
    pendingUpdate = apply;
    // Nothing open? Update silently. Otherwise never interrupt someone's analysis.
    if (!state.dataset) apply();
    else showUpdateBar();
  },
}).then((u) => {
  updates = u;
  renderFooter();
});
watchInstallPrompt((install) => {
  installApp = install;
  renderFooter();
});
renderFooter();

// After an update, tell people what changed (once).
const lastSeen = store.get('version', null);
if (lastSeen && compareVersions(VERSION, lastSeen) > 0) {
  const t = el('div', { class: 'toast info', role: 'status' }, `Lumora updated to v${VERSION}. `,
    el('button', { class: 'link-btn on-dark', type: 'button', onclick: () => { t.remove(); showWhatsNew(lastSeen); } }, "See what's new"));
  document.body.append(t);
  setTimeout(() => t.remove(), 10000);
}
store.set('version', VERSION);

// Expose for debugging and automated tests.
window.lumora = { state, loadText, loadSample, addStep, undo, saveNow, version: VERSION };

const params = new URLSearchParams(location.search);
const reopen = store.get('openProject', null);
if (params.get('sample')) loadSample(params.get('sample'));
else if (reopen) {
  render();
  loadProject(reopen)
    .then((json) => {
      if (json && !state.dataset) {
        openProject(json);
        toast('Welcome back! Your work was restored.', 'info');
      }
    })
    .catch(() => {});
} else render();
