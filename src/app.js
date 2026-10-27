import { buildDataset, datasetFromText, TYPES } from './core/infer.js';
import { applyStep, DATE_PARTS, describeStep, duplicateRows, niceBinSize, runRecipe, splitCount, uniqueName } from './core/clean.js';
import { FUNCTIONS, evaluateFormula } from './core/formula.js';
import { testColumns } from './core/significance.js';
import { readXlsx } from './core/xlsx.js';
import { describe, extent, frequencies, histogram, numbers, correlationMatrix, correlationStrength } from './core/stats.js';
import {
  AGGREGATIONS, FILTER_OPS, NO_VALUE_OPS, aggregate, applyFilters, datasetToCSV, formatDate, formatNumber, formatValue,
  groupBy, pivotTable, pivotToTable, searchRows, sortIndices, toCSV,
} from './core/transform.js';
import { OVERVIEW_SAMPLE, overviewData } from './core/overview.js';
import { CHART_TYPES, buildChartData, suggestChart } from './core/chartspec.js';
import { GLOSSARY, LESSONS } from './core/learn.js';
import { SAMPLES, sampleCSV } from './core/samples.js';
import { el, appendTo, clear, select, download, installTooltip } from './ui/dom.js';
import { renderChart, heatmap, sparkHistogram } from './ui/charts.js';
import { exportChart } from './ui/export.js';
import { initUpdates, watchInstallPrompt, compareVersions } from './ui/updates.js';
import { VERSION, CHANGELOG } from './version.js';
import { exampleQuestions, parseQuestion } from './core/ask.js';
import { canBeTarget, keyDrivers, strengthWord } from './core/drivers.js';
import { deserializeProject, isProject, newProjectId, projectSummary, serializeProject } from './core/project.js';
import { deleteProject, listProjects, loadProject, saveProject } from './ui/storage.js';
import { loadFileInBackground } from './ui/loader.js';
import { matchColumns, previewJoin, rawTable, suggestJoinKeys } from './core/combine.js';
import { DEFAULT_HORIZON, HORIZONS } from './core/forecast.js';
import { EXCEL_MAX_ROWS, datasetSheet, writeXlsx } from './core/xlsxwrite.js';
import { isNativeApp } from './ui/native.js';
import { healthCheck, healthScore } from './core/health.js';
import { isPortable, isRecipe, makeRecipe, recipeFits, recipeSteps } from './core/recipe.js';
import { rankCommands } from './core/palette.js';
import { FORM_KIND } from './core/forms.js';
import { createFormsUI } from './ui/forms-ui.js';
import { createAnalysesUI, TOOLS as ANALYSIS_TOOLS } from './ui/analyses-ui.js';
import { decodeText, isLumoraFile } from './core/encoding.js';

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
  recipeOffer: null, // a saved cleaning recipe that fits the file just opened
  page: null, // null (home or workspace) | 'forms' (form maker) | 'respond' (filling in a shared form)
};

let indices = [];

const TABS = [
  { id: 'overview', label: 'Overview', icon: '✦' },
  { id: 'analyses', label: 'Analyses', icon: '◇' },
  { id: 'table', label: 'Table', icon: '▦' },
  { id: 'chart', label: 'Chart', icon: '∿' },
  { id: 'summarize', label: 'Summarize', icon: 'Σ' },
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

/** Android's in-app browser has no print dialog, so say so instead of silently doing nothing. */
function printReport() {
  if (isNativeApp()) {
    alert('Printing isn\'t available in the Android app yet. Open Lumora in Chrome or on a computer to print or save the report as a PDF.');
    return;
  }
  window.print();
}

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

// ---------- big data: remember results and sample the heaviest analyses ----------

// Results are remembered per set of rows; the set is rebuilt whenever data or filters change,
// so switching tabs or toggling Learn mode never recalculates.
const memoStore = new WeakMap();
function memo(rows, key, fn) {
  let m = memoStore.get(rows);
  if (!m) memoStore.set(rows, (m = new Map()));
  if (!m.has(key)) m.set(key, fn());
  return m.get(key);
}

/** Key drivers and significance tests look at up to this many rows (evenly spread). */
const SAMPLE_LIMIT = 100_000;
function analysisRows(rows) {
  if (rows.length <= SAMPLE_LIMIT) return rows;
  return memo(rows, 'sample', () => {
    const step = rows.length / SAMPLE_LIMIT;
    return Array.from({ length: SAMPLE_LIMIT }, (_, k) => rows[Math.floor(k * step)]);
  });
}
function sampleNote(limit = SAMPLE_LIMIT) {
  return indices.length > limit && el('p', { class: 'sample-note' }, `ⓘ Large dataset: the analyses in this view use an evenly spread sample of ${limit.toLocaleString('en-US')} of the ${indices.length.toLocaleString('en-US')} rows. Counts, missing values, filters, tables, summaries and exports always use every row.`);
}

// Results that depend only on the data (not on filters), remembered per dataset version.
const datasetMemo = new WeakMap();
function perDataset(key, fn) {
  const ds = state.dataset;
  let m = datasetMemo.get(ds);
  if (!m) datasetMemo.set(ds, (m = new Map()));
  if (!m.has(key)) m.set(key, fn());
  return m.get(key);
}

/** Above this many cells the health check waits for a click, so opening a huge file stays instant. */
const HEALTH_AUTO_CELLS = 2_000_000;
const healthIssues = () => perDataset('health', () => healthCheck(state.dataset));
const healthReady = () => datasetMemo.get(state.dataset)?.has('health') || state.dataset.rowCount * cols().length <= HEALTH_AUTO_CELLS;

function recompute() {
  indices = state.dataset ? applyFilters(state.dataset, state.filters) : [];
}

function update({ keepRows = false } = {}) {
  if (!keepRows) recompute();
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

function loadDataset(ds, overview = null) {
  if (!ds.columns.length || !ds.rowCount) throw new Error('No rows found. Is the first line a header row?');
  state.original = ds;
  state.steps = [];
  state.dataset = ds;
  state.page = null;
  state.clean = {};
  state.addingFilter = null;
  state.projectId = newProjectId();
  state.report = [];
  state.ask = { question: '', parsed: null };
  state.drivers = { target: null };
  store.set('openProject', state.projectId);
  warnedTooBig = false;
  const recipe = store.get('lastRecipe', null);
  state.recipeOffer = isRecipe(recipe) && recipeFits(recipe, ds).fits ? recipe : null;
  chooseDefaults();
  state.tab = 'overview';
  recompute();
  // The background loader already computed the Overview for all rows; reuse it.
  if (overview && indices.length === ds.rowCount) memo(indices, 'overview', () => overview);
  update({ keepRows: true });
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
      if (json?.kind === 'lumora-responses') {
        toast('That’s a file of form answers. Open the form in the form maker, then Responses → Import answers → Choose responses files.', 'info');
        return true;
      }
      if (json?.kind === FORM_KIND) {
        formsUI.openFormFile(json);
        state.page = 'respond';
        render();
        return true;
      }
      if (isRecipe(json)) {
        if (state.dataset) applyRecipe(json);
        else toast('That’s a cleaning recipe. Open a data file first, then apply it from the Clean tab.', 'info');
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

// ---------- reading files (in the background, with progress) ----------

const STAGES = {
  reading: [0, 0.05, 'Reading the file…'],
  parsing: [0.05, 0.7, 'Reading rows…'],
  columns: [0.7, 0.95, 'Working out column types…'],
  sending: [0.95, 0.99, 'Almost done…'],
  finishing: [0.99, 1, 'Almost done…'],
};

/** A progress card that only appears if loading takes more than a moment. */
function progressCard(fileName, onCancel) {
  const label = el('span', { class: 'muted small' }, 'Reading the file…');
  const fill = el('span', { class: 'progress-fill' });
  const pct = el('span', { class: 'progress-pct' }, '0%');
  const card = el('div', { class: 'load-progress', role: 'status', 'aria-live': 'polite' },
    el('strong', {}, `Opening ${fileName}`),
    el('div', { class: 'progress-track' }, fill),
    el('div', { class: 'progress-row' }, label, pct),
    el('button', { class: 'btn ghost small', type: 'button', onclick: onCancel }, 'Cancel'));
  const timer = setTimeout(() => document.body.append(card), 250);
  return {
    update(stage, fraction) {
      const [a, b, text] = STAGES[stage] ?? STAGES.finishing;
      const f = a + (b - a) * Math.min(1, Math.max(0, fraction));
      fill.style.width = `${Math.round(f * 100)}%`;
      pct.textContent = `${Math.round(f * 100)}%`;
      label.textContent = text;
    },
    hide: () => card.remove(),
    show: () => document.body.append(card),
    close() {
      clearTimeout(timer);
      card.remove();
    },
  };
}

/** Ask which sheet of a workbook to open. Resolves the index, or null if the dialog is closed. */
function chooseSheet(fileName, sheets) {
  return new Promise((resolve) => {
    let picked = null;
    openDialog('Choose a sheet',
      el('p', { class: 'muted' }, `${fileName} has ${sheets.length} sheets with data.`),
      el('div', { class: 'sheet-list' }, sheets.map((s, i) =>
        el('button', { class: 'card sheet', type: 'button', onclick: () => { picked = i; $dialog.close(); } },
          el('strong', {}, s.name), el('span', { class: 'muted' }, `${plural(s.rows, 'row')} · ${plural(s.columns, 'column')}`)))));
    $dialog.addEventListener('close', () => resolve(picked), { once: true });
  });
}

/** Fallback when the browser can't run the background loader: read on the page. */
function readOnPage(file) {
  return new Promise((resolve, reject) => {
    const excel = /\.(xlsx|xlsm)$/i.test(file.name);
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('the file could not be opened'));
    reader.onload = async () => {
      try {
        if (excel) {
          const sheets = await readXlsx(reader.result);
          const idx = sheets.length === 1 ? 0 : await chooseSheet(file.name, sheets.map((s) => ({ name: s.name, rows: s.rows.length, columns: s.headers.length })));
          if (idx == null) return resolve(null);
          const base = file.name.replace(/\.[^.]+$/, '');
          const sheet = sheets[idx];
          resolve({ dataset: buildDataset(sheets.length > 1 ? `${base} · ${sheet.name}` : base, sheet.headers, sheet.rows) });
          return;
        }
        const text = decodeText(reader.result);
        if (isLumoraFile(text)) return resolve(lumoraResult(text));
        resolve({ dataset: datasetFromText(text, file.name) });
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/** A Lumora JSON file: a project to open, or something else (recipe, form, responses) for loadText. */
function lumoraResult(text) {
  const json = JSON.parse(text);
  return isProject(json) ? { project: json } : { lumoraText: text };
}

/**
 * Read any supported file. Resolves { dataset }, { project } or { lumoraText }, or null when cancelled
 * or failed (the person has already been told why).
 */
async function readFile(file, { allowProject = true } = {}) {
  if (/\.xls$/i.test(file.name)) {
    toast('Old .xls files aren\'t supported. In Excel choose File → Save As → Excel Workbook (.xlsx) or CSV.');
    return null;
  }
  if (file.size > 1.5 * 1024 ** 3) {
    toast('That file is over 1.5 GB, which is more than a browser can hold in memory. Try splitting it into smaller files.');
    return null;
  }
  let job = null;
  const progress = progressCard(file.name, () => job?.cancel());
  job = loadFileInBackground(file, (stage, f) => progress.update(stage, f));
  try {
    let result = await job.promise;
    if (result.kind === 'fallback') {
      progress.update('parsing', 0.5);
      result = await readOnPage(file);
      if (!result) return null;
    } else if (result.kind === 'project') {
      result = lumoraResult(result.text);
    } else if (result.kind === 'sheets') {
      progress.hide();
      const index = await chooseSheet(file.name, result.sheets);
      if (index == null) {
        job.cancel();
        return null;
      }
      progress.show();
      result = await result.pick(index);
    }
    if ((result.project || result.lumoraText) && !allowProject) throw new Error('that is a Lumora file (a project, recipe or form), not a data file.');
    if (result.dataset && (!result.dataset.columns.length || !result.dataset.rowCount)) throw new Error('no rows found. Is the first line a header row?');
    return result;
  } catch (err) {
    if (err.message !== 'cancelled') toast(`Couldn't read ${file.name}: ${err.message}`);
    return null;
  } finally {
    progress.close();
  }
}

async function loadFile(file) {
  if (!file) return;
  const result = await readFile(file);
  if (!result) return;
  try {
    if (result.lumoraText) loadText(result.lumoraText, file.name);
    else if (result.project) openProject(result.project, { imported: true });
    else loadDataset(result.dataset, result.overview);
  } catch (err) {
    toast(`Couldn't open ${file.name}: ${err.message}`);
  }
}

/** Several files at once: open the first and stack the others under it when their columns match. */
async function loadFiles(fileList) {
  const files = [...fileList];
  if (files.length <= 1) return loadFile(files[0]);
  const first = await readFile(files[0], { allowProject: false });
  if (!first) return;
  loadDataset(first.dataset);
  const headers = first.dataset.columns.map((c) => c.name);
  const steps = [];
  const skipped = [];
  for (const f of files.slice(1)) {
    const r = await readFile(f, { allowProject: false });
    if (!r) continue;
    const other = rawTable(r.dataset);
    const m = matchColumns(headers, other.headers);
    if (!m.onlyBase.length && !m.onlyOther.length) steps.push({ op: 'append', data: other, sourceColumn: 'source', baseLabel: first.dataset.name });
    else skipped.push(f.name);
  }
  if (steps.length) {
    setSteps(steps);
    toast(`Stacked ${files.length - skipped.length} files. The "source" column shows which file each row came from.`, 'info');
  }
  if (skipped.length) setTimeout(() => toast(`${skipped.join(', ')} ${skipped.length === 1 ? 'has' : 'have'} different columns, so ${skipped.length === 1 ? 'it was' : 'they were'} not stacked. Use Clean → Combine with another file to join ${skipped.length === 1 ? 'it' : 'them'}.`), steps.length ? 4500 : 0);
}

function loadSample(id) {
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) {
    toast(`There's no practice dataset called "${id}".`);
    render();
    return false;
  }
  const ok = loadText(sampleCSV(id), `${sample.name}.csv`);
  // Practice data never offers your own cleaning recipes.
  if (ok && state.recipeOffer) {
    state.recipeOffer = null;
    render();
  }
  return ok;
}

function runLesson(lesson) {
  const t = lesson.try;
  if (state.dataset?.name !== SAMPLES.find((s) => s.id === t.sample).name || state.steps.length) loadSample(t.sample);
  else state.filters = [];
  if (t.chart) {
    state.chart = { type: t.chart.type ?? 'auto', x: colIndex(t.chart.x), y: t.chart.y ? colIndex(t.chart.y) : null, agg: 'mean', color: null, forecast: t.chart.forecast ?? null };
  }
  if (t.summarize) {
    state.summarize = {
      by: colIndex(t.summarize.by),
      dateUnit: t.summarize.dateUnit ?? 'month',
      cols: t.summarize.cols ? colIndex(t.summarize.cols) : null,
      colUnit: t.summarize.colUnit ?? 'month',
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
    el('section', { class: 'collect' },
      el('div', { class: 'card collect-card' },
        el('div', { class: 'emoji', 'aria-hidden': 'true' }, '📝'),
        el('div', { class: 'grow' },
          el('h2', {}, 'No data yet? Collect your own'),
          el('p', { class: 'muted' }, 'Make a custom form (survey, sign-up sheet, stock count, expense log), fill it in or share a link, and analyse the answers here.')),
        el('button', { class: 'btn primary', type: 'button', onclick: openFormMaker }, 'Open the form maker'))),
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

// Analyses tab ("What do you want to find out?"). Key drivers lives inside it now.
const analysesUI = createAnalysesUI({
  dataset: () => state.dataset,
  rows: () => indices,
  sample: (rows) => analysisRows(rows),
  memo,
  plural,
  pin: (item) => pin(item),
  addStep: (step) => addStep(step),
  renderDrivers: () => renderDrivers(),
  rerender: () => render(),
  filterOnDate: (name, day) => {
    const column = colIndex(name);
    if (column < 0) return;
    state.filters.push({ column, op: 'on', value: day });
    state.tab = 'table';
    state.table.page = 0;
    update();
    window.scrollTo(0, 0);
  },
});

function openAnalysis(id) {
  analysesUI.open(id);
  state.tab = 'analyses';
  render();
  window.scrollTo(0, 0);
}

function renderWorkspace() {
  // Older projects and lessons may still say "drivers": it is a question in Analyses now.
  if (state.tab === 'drivers') {
    analysesUI.open('drivers');
    state.tab = 'analyses';
  }
  const nav = el('nav', { class: 'tabs', role: 'tablist' }, TABS.map((t) =>
    el('button', {
      class: `tab${state.tab === t.id ? ' active' : ''}`, role: 'tab', type: 'button',
      'aria-selected': String(state.tab === t.id),
      onclick: () => { state.tab = t.id; render(); },
    }, el('span', { class: 'tab-icon', 'aria-hidden': 'true' }, t.icon), t.label, t.count?.() ? el('span', { class: 'tab-count' }, t.count()) : null)));

  const views = { overview: renderOverview, analyses: () => analysesUI.render(), table: renderTable, chart: renderChartTab, summarize: renderSummarize, clean: renderClean, report: renderReport, learn: renderLearn };
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
  const ov = memo(indices, 'overview', () => overviewData(ds, indices));
  const { missing, insights } = ov;

  return el('div', { class: 'overview' },
    recipeBanner(),
    healthBanner(),
    renderAsk(),
    quickQuestions(),
    el('div', { class: 'kpis' },
      kpi('Rows', indices.length.toLocaleString('en-US')),
      kpi('Columns', c.length),
      kpi('Missing cells', cells ? `${((missing / cells) * 100).toFixed(1)}%` : '–', 'missing'),
      kpi('Column types', Object.entries(TYPE_LABELS).map(([t, label]) => {
        const n = c.filter((col) => col.type === t).length;
        return n ? `${n} ${label.toLowerCase()}` : null;
      }).filter(Boolean).join(' · '), 'types', true)),
    sampleNote(OVERVIEW_SAMPLE),
    el('section', {},
      el('h2', {}, 'What Lumora noticed'),
      learnTip('types', 'Lumora reads every column, works out what kind of data it holds and flags anything interesting or suspicious.'),
      el('div', { class: 'insights' }, insights.map(insightCard))),
    el('section', {},
      el('h2', {}, 'Columns'),
      el('div', { class: 'column-grid' }, c.map((col, i) => columnCard(col, i, ov.cards[i])))),
    ov.corr && el('section', {},
      el('h2', {}, 'How number columns relate'),
      learnTip('correlation'),
      el('div', { class: 'card chart-card scroll-x' }, heatmap(ov.corr.names, ov.corr.matrix))));
}

/** A few one-click questions from the Analyses tab that fit this data. */
function quickQuestions() {
  const ready = analysesUI.ready().filter((t) => t.id !== 'drivers').slice(0, 5);
  if (!ready.length) return null;
  return el('div', { class: 'quick-questions' },
    el('span', { class: 'muted small' }, 'Find out:'),
    ready.map((t) => el('button', { class: 'chip-btn', type: 'button', onclick: () => openAnalysis(t.id) }, el('span', { 'aria-hidden': 'true' }, `${t.icon} `), t.question)),
    el('button', { class: 'link-btn', type: 'button', onclick: () => openAnalysis(null) }, 'More questions →'));
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

function columnCard(col, index, summary) {
  const { missingPct } = summary;
  let body;
  if (summary.stats) {
    const d = summary.stats;
    body = [sparkHistogram(summary.bins), statLine([['mean', d.mean, 'mean'], ['median', d.median, 'median'], ['min', d.min], ['max', d.max]])];
  } else if (summary.range) {
    body = el('p', { class: 'muted' }, `${formatDate(summary.range[0])} → ${formatDate(summary.range[1])}`);
  } else if (summary.top) {
    const top = summary.top;
    if (top[0].count === 1) {
      body = [el('p', { class: 'muted small' }, `Every value is different (${plural(summary.distinct, 'distinct value')}), e.g.`),
        el('p', { class: 'sample-values' }, top.map((f) => formatValue(f.value, col.type)).join(', '))];
    } else body = [
      el('div', { class: 'mini-bars' }, top.map((f) =>
        el('div', { class: 'mini-bar', 'data-tip': `${formatValue(f.value, col.type)}: ${f.count} rows` },
          el('span', { class: 'mini-label' }, formatValue(f.value, col.type)),
          el('span', { class: 'mini-track' }, el('span', { class: 'mini-fill', style: { width: `${(f.count / summary.count) * 100}%` } })),
          el('span', { class: 'mini-pct' }, `${Math.round((f.count / summary.count) * 100)}%`)))),
      summary.distinct > 4 && el('p', { class: 'muted small' }, `${plural(summary.distinct, 'distinct value')}`),
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
    const [lo, hi] = extent(present);
    rows.push(['Earliest', formatDate(lo)], ['Latest', formatDate(hi)]);
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
let searchTimer = null;

function renderTable() {
  const t = state.table;
  const wrap = el('div', { class: 'table-view' });
  const body = el('div');
  const draw = () => {
    // Remembered per search and sort, so paging through a big table doesn't re-sort every row.
    const rows = memo(indices, `table:${t.search}\u0001${t.sort}\u0001${t.dir}`, () => {
      const found = searchRows(state.dataset, indices, t.search);
      return t.sort != null ? sortIndices(state.dataset, found, t.sort, t.dir) : found;
    });
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
  appendTo(wrap,
    el('div', { class: 'toolbar' },
      el('input', { type: 'search', class: 'search', placeholder: 'Search all columns…', value: t.search, 'aria-label': 'Search rows', oninput: (e) => {
        t.search = e.target.value;
        t.page = 0;
        // Searching millions of cells on every keystroke would lag; wait for a pause in typing.
        clearTimeout(searchTimer);
        if (state.dataset.rowCount > 50000) searchTimer = setTimeout(draw, 250);
        else draw();
      } }),
      el('div', { class: 'toolbar-actions' },
        el('button', { class: 'btn small', onclick: () => download(`${state.dataset.name}-filtered.csv`, datasetToCSV(state.dataset, indices)) }, '⇩ CSV'),
        el('button', { class: 'btn small', onclick: () => exportExcel(`${state.dataset.name}${state.filters.length ? ' filtered' : ''}`, [datasetSheet(state.dataset, indices)]) }, '⇩ Excel'))),
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
  let data = type ? buildChartData(state.dataset, indices, { type, x: ch.x, y: ch.y, agg: ch.agg, color: ch.color }) : { error: suggestion.reason };
  // Forecasts need a date axis; the date grouping (day/month/year) decides the sensible horizons.
  const canForecast = type === 'line' && data.xIsDate && HORIZONS[data.unit];
  const horizon = canForecast && ch.forecast ? (HORIZONS[data.unit].some(([h]) => h === ch.forecast) ? ch.forecast : DEFAULT_HORIZON[data.unit]) : null;
  if (horizon) data = buildChartData(state.dataset, indices, { type, x: ch.x, y: ch.y, agg: ch.agg, forecast: horizon });
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
      ch.color ?? '', (v) => { ch.color = v === '' ? null : +v; render(); })),
    canForecast && field('Forecast', select([{ value: '', label: 'Off' }, ...HORIZONS[data.unit].map(([h, label]) => ({ value: h, label: `Next ${label}` }))], horizon ?? '', (v) => { ch.forecast = v === '' ? null : +v; render(); }, { 'aria-label': 'Forecast' })));

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
          el('button', { class: 'btn small', type: 'button', title: 'Excel file with the chart’s data and an editable Excel chart', onclick: () => exportExcel(`${state.dataset.name} ${title}`, [chartSheet(data, title), ...dataSheetFor(indices)]) }, '⇩ Excel'),
          el('button', { class: 'btn small primary', type: 'button', onclick: () => pin({ kind: 'chart', title: title || 'Chart', chart: chartRefs(state.chart, type) }) }, '📌 Add to report')),
      ]),
    significanceCard(ch),
    type && learnTip(CHART_TYPES[type].term));
}

/** One sheet holding a chart's data plus the matching editable Excel chart. */
function chartSheet(data, title) {
  const chart = (type, valueColumns, extra = {}) => ({ type, title, valueColumns, xTitle: data.xLabel ?? data.groupLabel, yTitle: data.yLabel ?? data.valueLabel, ...extra });
  switch (data.type) {
    case 'bar':
      return { name: 'Chart data', headers: [data.xLabel, data.valueLabel], types: ['text', 'number'], rows: data.bars.map((b) => [b.label, b.value]), chart: chart('bar', [1]) };
    case 'histogram':
      return { name: 'Chart data', headers: [`${data.xLabel} range`, 'Rows'], types: ['text', 'number'], rows: data.bins.map((b) => [`${formatNumber(b.x0)} to ${formatNumber(b.x1)}`, b.count]), chart: chart('bar', [1], { yTitle: 'Rows' }) };
    case 'scatter':
      return { name: 'Chart data', headers: [data.xLabel, data.yLabel], types: ['number', 'number'], rows: data.points.map((p) => [p.x, p.y]), chart: chart('scatter', [1]) };
    case 'box':
      return {
        name: 'Chart data', headers: [data.groupLabel ?? data.valueLabel, 'Rows', 'Minimum', 'Q1', 'Median', 'Q3', 'Maximum', 'Mean'], types: ['text', ...Array(7).fill('number')],
        rows: data.groups.map((g) => [g.label, g.stats.count, g.stats.min, g.stats.q1, g.stats.median, g.stats.q3, g.stats.max, g.stats.mean]),
        chart: chart('bar', [4], { title: `Median ${data.valueLabel}`, yTitle: `median ${data.valueLabel}` }),
      };
    default: {
      // Line chart, with forecast columns when a forecast is shown.
      const f = data.forecast?.points ?? [];
      const xType = data.xIsDate ? 'date' : 'number';
      const headers = [data.xLabel, data.yLabel, ...(f.length ? ['Forecast', 'Likely low', 'Likely high'] : [])];
      const rows = [...data.points.map((p) => [p.x, p.y, ...(f.length ? [null, null, null] : [])]), ...f.map((p) => [p.x, null, p.y, p.lo, p.hi])];
      const seriesStyles = [{}, { color: 'E8833A', dash: true }, { color: 'A0AEC0', dash: true }, { color: 'A0AEC0', dash: true }];
      return { name: 'Chart data', headers, types: [xType, 'number', 'number', 'number', 'number'], rows, chart: chart('line', f.length ? [1, 2, 3, 4] : [1], { seriesStyles }) };
    }
  }
}

function significanceCard(ch) {
  const res = memo(indices, `test:${ch.x}:${ch.y}`, () => testColumns(state.dataset, analysisRows(indices), ch.x, ch.y));
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
    const f = data.forecast;
    if (f?.error) notes.push(`Forecast unavailable: ${f.error}`);
    else if (f) {
      const per = { day: 'day', month: 'month', year: 'year' }[f.unit];
      notes.push([el('strong', {}, 'Forecast: '), `the next ${plural(f.horizon, per)} should total about ${formatNumber(f.total.y)} (likely ${formatNumber(f.total.lo)} to ${formatNumber(f.total.hi)}), around ${formatNumber(f.average)} per ${per}. The shaded band is the `, termLink('forecast', 'likely range'), ` (80% of outcomes should fall inside it). ${f.note}`]);
      if (f.accuracy?.pctError != null) notes.push(`How reliable? When Lumora hid the last ${plural(f.accuracy.periods, per)} and forecast them, it was off by about ${Math.round(f.accuracy.pctError * 100)}% on average.`);
      notes.push('Forecasts assume the future behaves like the past. Holidays, promotions or one-off events are not known to Lumora.');
    }
  }
  return notes.length ? el('ul', { class: 'chart-notes' }, notes.map((n) => el('li', {}, n))) : null;
}

// ---------- summarize ----------

const DATE_UNITS = [['day', 'day'], ['month', 'month'], ['year', 'year'], ['weekday', 'day of week']].map(([value, label]) => ({ value, label }));
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Write sheets to an .xlsx file and download it. */
async function exportExcel(fileBase, sheets) {
  if (sheets.some((sh) => sh.rows.length > EXCEL_MAX_ROWS)) toast(`Excel holds at most ${EXCEL_MAX_ROWS.toLocaleString('en-US')} rows per sheet, so only the first ones were exported.`);
  else if (sheets.reduce((n, sh) => n + sh.rows.length, 0) > 50000) toast('Preparing the Excel file…', 'info');
  await new Promise((r) => setTimeout(r, 30)); // let the message paint before the heavy work
  try {
    const bytes = await writeXlsx({ sheets });
    download(`${fileBase.replace(/[^\w\- ]+/g, '').trim() || 'lumora'}.xlsx`, new Blob([bytes], { type: XLSX_MIME }));
  } catch (err) {
    toast(`Couldn't create the Excel file: ${err.message}`);
  }
}

/** The filtered data as an extra sheet, when it is a sensible size. */
const dataSheetFor = (rows) => (rows.length <= 100000 ? [datasetSheet(state.dataset, rows, 'Data')] : []);

function summaryResult(s, rows) {
  return memo(rows, `summary:${JSON.stringify([s.by, s.dateUnit, s.aggs, s.sort ?? null])}`, () => runSummary(s, rows));
}

function pivotResult(s, rows) {
  const a = s.aggs[0] ?? { fn: 'count', column: null };
  return memo(rows, `pivot:${JSON.stringify([s.by, s.dateUnit, s.cols, s.colUnit, a])}`, () =>
    pivotTable(state.dataset, rows, { rows: s.by, rowUnit: s.dateUnit, columns: s.cols, colUnit: s.colUnit ?? 'month', fn: a.fn, column: a.column }));
}

function renderPivot(p) {
  const vals = p.cells.flat().filter(Number.isFinite);
  const [lo, hi] = extent(vals);
  // Shade cells by value so patterns jump out (a "heat map" table).
  const shade = (v) => (Number.isFinite(v) && hi > lo ? { background: `color-mix(in srgb, var(--accent) ${Math.round(6 + (44 * (v - lo)) / (hi - lo))}%, transparent)` } : null);
  return el('div', { class: 'card table-scroll pivot' },
    el('table', { class: 'data-table pivot-table' },
      el('thead', {}, el('tr', {},
        el('th', { class: 'corner' }, el('span', { class: 'muted small' }, `${p.rowLabel} ↓ · ${p.colLabel} →`)),
        p.colKeys.map((k) => el('th', { class: 'num' }, k)),
        el('th', { class: 'num total' }, 'Total'))),
      el('tbody', {}, p.rowKeys.map((rk, r) => el('tr', {},
        el('th', { class: 'row-key' }, rk),
        p.cells[r].map((v, c) => el('td', { class: 'num', style: shade(v), 'data-tip': `${rk} · ${p.colKeys[c]}: ${formatNumber(v)}` }, v == null ? '' : formatNumber(v))),
        el('td', { class: 'num total' }, formatNumber(p.rowTotals[r]))))),
      el('tfoot', {}, el('tr', {},
        el('th', {}, 'Total'),
        p.colTotals.map((v) => el('td', { class: 'num total' }, formatNumber(v))),
        el('td', { class: 'num total' }, formatNumber(p.grandTotal))))),
    p.hiddenColumns > 0 && el('p', { class: 'muted small' }, `Showing the ${p.colKeys.length} largest of ${p.colKeys.length + p.hiddenColumns} columns. Choose a coarser grouping (e.g. month instead of day) to see everything.`));
}

function pivotSheets(p) {
  const t = pivotToTable(p);
  const series = Math.min(12, p.colKeys.length);
  return [{
    name: 'Pivot', headers: t.headers, types: ['text', ...p.colKeys.map(() => 'number'), 'number'], rows: t.rows,
    chart: { type: 'bar', title: `${p.valueLabel} by ${p.rowLabel} and ${p.colLabel}`, valueColumns: Array.from({ length: series }, (_, k) => k + 1), rowLimit: p.rowKeys.length, xTitle: p.rowLabel, yTitle: p.valueLabel },
  }];
}

function summarySheets(result, byCol, dateUnit) {
  const overTime = byCol.type === 'date' && dateUnit !== 'weekday';
  return [{
    name: 'Summary', headers: result.headers, types: [byCol.type === 'number' ? 'number' : 'text', ...result.headers.slice(1).map(() => 'number')], rows: result.rows,
    chart: result.headers.length > 1 ? { type: overTime ? 'line' : 'bar', title: `${result.headers[1]} by ${result.headers[0]}`, valueColumns: [1], xTitle: result.headers[0], yTitle: result.headers[1] } : null,
  }];
}

function renderSummarize() {
  const s = state.summarize;
  const c = cols();
  const byCol = c[s.by];
  const pivotCol = s.cols == null ? null : c[s.cols];
  const numericOptions = c.map((col, i) => ({ col, i })).filter(({ col }) => col.type === 'number' || col.type === 'boolean');
  const pivot = pivotCol ? pivotResult(s, indices) : null;
  const result = pivot ? null : summaryResult(s, indices);

  const aggRows = (pivot ? s.aggs.slice(0, 1) : s.aggs).map((a, k) => el('div', { class: 'agg-row' },
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
    !pivot && s.aggs.length > 1 && el('button', { class: 'icon-btn', 'aria-label': 'Remove summary', onclick: () => { s.aggs.splice(k, 1); render(); } }, '✕')));

  const firstValueCol = result && result.headers.length > 1 ? 1 : null;
  const bars = firstValueCol && result.rows.map((r) => ({ label: String(r[0]), value: r[firstValueCol] })).filter((b) => Number.isFinite(b.value));
  const title = pivot ? `${pivot.valueLabel} by ${pivot.rowLabel} and ${pivot.colLabel}` : `${result.headers.slice(1).join(', ')} by ${result.headers[0]}`;
  const table = pivot ? pivotToTable(pivot) : result;

  return el('div', { class: 'summarize-view' },
    el('div', { class: 'card summarize-controls' },
      el('div', { class: 'agg-row' },
        el('span', { class: 'field-label' }, 'Group rows by'),
        select(c.map((col, i) => ({ value: i, label: col.name })), s.by, (v) => { s.by = +v; render(); }, { 'aria-label': 'Group by' }),
        byCol.type === 'date' && select(DATE_UNITS, s.dateUnit, (v) => { s.dateUnit = v; render(); }, { 'aria-label': 'Date grouping' })),
      el('div', { class: 'agg-row' },
        el('span', { class: 'field-label' }, 'Split into columns by'),
        select([{ value: '', label: '— none (simple summary) —' }, ...c.map((col, i) => ({ value: i, label: col.name }))], s.cols ?? '', (v) => {
          s.cols = v === '' ? null : +v;
          if (s.cols != null && c[s.cols].type === 'date') s.colUnit ??= 'month';
          render();
        }, { 'aria-label': 'Split into columns by' }),
        pivotCol?.type === 'date' && select(DATE_UNITS, s.colUnit ?? 'month', (v) => { s.colUnit = v; render(); }, { 'aria-label': 'Column date grouping' }),
        !pivot && el('span', { class: 'muted small' }, 'Pick a second column to get a two-way pivot table.')),
      el('div', { class: 'field-label' }, 'and calculate'),
      aggRows,
      !pivot && el('button', { class: 'btn ghost small', type: 'button', onclick: () => { s.aggs.push(numericOptions.length ? { fn: 'mean', column: numericOptions[0].i } : { fn: 'count', column: null }); render(); } }, '+ Add another summary'),
      pivot && s.aggs.length > 1 && el('p', { class: 'muted small' }, 'A pivot table shows one summary at a time: the first one above.')),
    learnTip(pivot ? 'pivot' : 'groupby'),
    pivot ? renderPivot(pivot) : el('div', { class: 'summary-grid' },
      el('div', { class: 'card table-scroll' },
        el('table', { class: 'data-table' },
          el('thead', {}, el('tr', {}, result.headers.map((h, j) => el('th', { class: j ? 'num' : '' }, h)))),
          el('tbody', {}, result.rows.slice(0, 500).map((r) => el('tr', {}, r.map((v, j) => el('td', { class: j ? 'num' : '' }, j ? formatNumber(v) : String(v)))))))),
      bars && bars.length > 0 && el('div', { class: 'card chart-card' },
        el('div', { class: 'chart-wrap' }, renderChart({ type: 'bar', xLabel: result.headers[0], valueLabel: result.headers[firstValueCol], bars: bars.slice(0, 30) })))),
    el('div', { class: 'toolbar' },
      el('span', { class: 'muted' }, pivot ? `${plural(pivot.rowKeys.length, 'row')} × ${plural(pivot.colKeys.length, 'column')}` : plural(result.rows.length, 'group')),
      el('div', { class: 'toolbar-actions' },
        el('button', { class: 'btn small', onclick: () => download(`${state.dataset.name}-${pivot ? 'pivot' : 'summary'}.csv`, toCSV(table.headers, table.rows)) }, '⇩ CSV'),
        el('button', { class: 'btn small', title: 'Excel file with the table, a chart and your data', onclick: () => exportExcel(`${state.dataset.name} ${pivot ? 'pivot' : 'summary'}`, [...(pivot ? pivotSheets(pivot) : summarySheets(result, byCol, s.dateUnit)), ...dataSheetFor(indices)]) }, '⇩ Excel + chart'),
        el('button', { class: 'btn small primary', type: 'button', onclick: () => pin({ kind: 'summary', title, summarize: summarizeRefs(state.summarize) }) }, '📌 Add to report'))));
}

// ---------- cleaning steps ----------

/** Column references in the UI are indices; remember them by name so they survive steps. */
function snapshotRefs() {
  const name = (i) => (i == null || i < 0 ? null : cols()[i]?.name ?? null);
  return {
    chart: { x: name(state.chart.x), y: name(state.chart.y), color: name(state.chart.color) },
    by: name(state.summarize.by),
    cols: name(state.summarize.cols),
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
  state.summarize.cols = idx(refs.cols);
  state.summarize.aggs = refs.aggs.map((a) => ({ ...a, column: idx(a.column) })).filter((a) => a.fn === 'count' || a.column != null);
  if (!state.summarize.aggs.length) state.summarize.aggs = [{ fn: 'count', column: null }];
  state.filters = refs.filters.map((f) => ({ ...f, column: idx(f.column) })).filter((f) => f.column != null);
  state.table.sort = idx(refs.sort);
  state.drivers.target = idx(refs.target);
}

function setSteps(steps, renames = {}, explain = (message) => message) {
  let ds;
  try {
    ds = runRecipe(state.original, steps);
  } catch (err) {
    toast(explain(err.message));
    return false;
  }
  const refs = snapshotRefs();
  state.steps = steps;
  state.dataset = ds;
  state.addingFilter = null;
  state.recipeOffer = null;
  // Remember the cleaning so the next file with the same columns can reuse it in one click.
  if (steps.some(isPortable)) store.set('lastRecipe', makeRecipe(steps, state.original.name, state.original));
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
      item.summarize.cols = swap(item.summarize.cols);
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
  const dupBy = names.includes(f.dupBy) ? f.dupBy : '';
  const dupCount = perDataset(`dups:${dupBy}`, () => duplicateRows(ds, dupBy ? [dupBy] : null).length);

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
    dupBy
      ? (dupCount ? `${plural(dupCount, 'row')} repeat${dupCount === 1 ? 's' : ''} a ${dupBy} that appears earlier (ignoring capitals and spaces). Removing keeps the first one.` : `Every ${dupBy} is unique.`)
      : (dupCount ? `${plural(dupCount, 'row')} ${dupCount === 1 ? 'is an exact copy' : 'are exact copies'} of an earlier row.` : 'No duplicate rows found.'),
    el('div', { class: 'form-row' },
      el('label', { class: 'muted small' }, 'Compare'),
      select([{ value: '', label: 'every column' }, ...names.map((n) => ({ value: n, label: `only ${n}` }))], dupBy, (v) => { f.dupBy = v; render(); }, { 'aria-label': 'Columns to compare' }),
      el('button', { class: 'btn primary small', type: 'button', disabled: !dupCount, onclick: () => addStep(dupBy ? { op: 'removeDuplicates', columns: [dupBy] } : { op: 'removeDuplicates' }) }, 'Remove duplicates')));

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
      ? el('ol', { class: 'step-list' }, state.steps.map((s, k) => el('li', {},
        el('span', {}, describeStep(s)),
        el('button', { class: 'step-x', type: 'button', title: 'Remove this step', 'aria-label': `Remove step: ${describeStep(s)}`, onclick: () => removeStep(k) }, '✕'))))
      : el('p', { class: 'muted' }, 'No changes yet. Each action you apply appears here.'),
    el('p', { class: 'small' }, `Now: ${plural(ds.rowCount, 'row')} × ${plural(c.length, 'column')}`),
    el('div', { class: 'history-actions' },
      el('button', { class: 'btn small', type: 'button', disabled: !state.steps.length, title: 'Ctrl+Z', onclick: undo }, '↶ Undo last'),
      el('button', { class: 'btn ghost small', type: 'button', disabled: !state.steps.length, onclick: () => { if (confirm('Remove all cleaning steps and go back to the original data?')) setSteps([]); } }, 'Start over'),
      el('button', { class: 'btn small', type: 'button', onclick: () => download(`${ds.name}-clean.csv`, datasetToCSV(ds, [...Array(ds.rowCount).keys()])) }, '⇩ Cleaned CSV'),
      el('button', { class: 'btn small', type: 'button', onclick: () => exportExcel(`${ds.name} clean`, [datasetSheet(ds, [...Array(ds.rowCount).keys()])]) }, '⇩ Cleaned Excel')),
    el('h3', { class: 'recipe-head' }, 'Recipe'),
    el('p', { class: 'muted small' }, 'Save these steps and replay them on next month’s file in one click. Lumora also offers your latest recipe automatically when you open a file with the same columns.'),
    el('div', { class: 'history-actions' },
      el('button', { class: 'btn small', type: 'button', disabled: !state.steps.some(isPortable), onclick: saveRecipeFile }, '⇩ Save recipe'),
      el('button', { class: 'btn small', type: 'button', onclick: pickRecipeFile }, '↻ Apply a recipe…')));

  return el('div', { class: 'clean-view' },
    el('div', { class: 'clean-actions' }, learnTip('cleaning'),
      healthCard(),
      el('h2', { class: 'clean-group' }, 'Fix problems'), dupCard, missingCard, textCard, replaceCard(),
      el('h2', { class: 'clean-group' }, 'Add columns'), formulaCard, groupCard(), datePartsCard(),
      el('h2', { class: 'clean-group' }, 'Reshape'), splitCard(), renameCard, keepCard, combineCard()),
    history);
}

// ---------- data health ----------

const scoreTone = (score) => (score >= 90 ? 'good' : score >= 70 ? 'ok' : 'poor');
const scoreBadge = (score) => el('span', { class: `score ${scoreTone(score)}`, title: 'Data health score out of 100' }, String(score));

function healthBanner() {
  if (!healthReady()) {
    return el('div', { class: 'health-banner' },
      el('span', { class: 'score' }, '?'),
      el('div', { class: 'grow' }, el('strong', {}, 'Data health'), ' ', el('span', { class: 'muted' }, 'This is a big file, so the check runs when you ask.')),
      el('button', { class: 'btn small', type: 'button', onclick: () => { healthIssues(); render(); } }, 'Check now'));
  }
  const issues = healthIssues();
  const score = healthScore(issues);
  const serious = issues.filter((i) => i.severity === 'high').length;
  return el('div', { class: `health-banner ${scoreTone(score)}` },
    scoreBadge(score),
    el('div', { class: 'grow' },
      el('strong', {}, 'Data health'), ' ',
      el('span', { class: 'muted' }, issues.length
        ? `${plural(issues.length, 'thing')} to check${serious ? ` (${serious} serious)` : ''}: ${issues.slice(0, 2).map((i) => i.title).join('; ')}${issues.length > 2 ? '; …' : ''}`
        : 'No problems found. Your data is ready to analyse.')),
    issues.length > 0 && el('button', { class: 'btn small', type: 'button', onclick: () => { state.tab = 'clean'; render(); window.scrollTo(0, 0); } }, 'Review and fix →'));
}

function healthCard() {
  if (!healthReady()) {
    return actionCard('Data health check', 'cleaning', 'Looks for duplicates, inconsistent spelling, numbers stored as text and empty columns.',
      el('button', { class: 'btn primary small', type: 'button', onclick: () => { healthIssues(); render(); } }, 'Run the check'));
  }
  const issues = healthIssues();
  const score = healthScore(issues);
  const safe = issues.filter((i) => i.safe);
  return el('section', { class: 'card action-card health-card' },
    el('div', { class: 'health-head' },
      scoreBadge(score),
      el('div', {},
        el('h3', {}, 'Data health check'),
        el('p', { class: 'muted' }, issues.length
          ? 'Fix each problem with one click, or fix the safe ones all at once. Every fix is a step you can undo.'
          : 'No problems found. Your data is ready to analyse.'))),
    issues.length > 0 && el('ul', { class: 'issue-list' }, issues.map((issue) =>
      el('li', { class: `issue sev-${issue.severity}` },
        el('span', { class: 'sev-dot', title: `${issue.severity} priority` }),
        el('div', { class: 'grow' },
          el('strong', {}, issue.title),
          el('p', { class: 'muted small' }, issue.detail)),
        issue.fix && el('button', { class: `btn small${issue.safe ? ' primary' : ''}`, type: 'button', onclick: () => addStep(issue.fix) }, issue.fixLabel)))),
    safe.length > 1 && el('button', { class: 'btn primary small', type: 'button', onclick: fixAllSafe }, `✓ Fix all ${safe.length} safe problems`),
    issues.length > safe.length && el('p', { class: 'muted small' }, 'Problems without a highlighted button need your judgement: their fix removes or changes information.'));
}

function fixAllSafe() {
  const fixes = healthIssues().filter((i) => i.safe).map((i) => i.fix);
  if (setSteps([...state.steps, ...fixes])) toast(`✓ Applied ${plural(fixes.length, 'fix')}. Undo removes them one at a time.`, 'info');
}

// ---------- more cleaning tools ----------

function replaceCard() {
  const f = state.clean;
  const names = cols().map((c) => c.name);
  const column = names.includes(f.replCol) ? f.replCol : (f.replCol = names[0]);
  const col = cols()[colIndex(column)];
  const count = el('span', { class: 'muted small' });
  const match = f.replMatch ?? 'exact';
  const recount = () => {
    const find = f.find ?? '';
    if (!find.trim()) {
      count.textContent = '';
      return;
    }
    const needle = find.trim().toLowerCase();
    const raw = col.raw;
    let n = 0;
    for (let i = 0; i < raw.length; i++) {
      const v = String(raw[i] ?? '').toLowerCase();
      if (match === 'contains' ? v.includes(find.toLowerCase()) : v.trim() === needle) n++;
    }
    count.textContent = n ? `${plural(n, 'row')} match` : 'No rows match';
  };
  recount();
  return actionCard('Find and replace', null, 'Fix a wrong or inconsistent value everywhere at once, e.g. change "NYC" to "New York". Leave "replace with" empty to blank it out.',
    el('div', { class: 'form-row' },
      select(names.map((n) => ({ value: n, label: n })), column, (v) => { f.replCol = v; render(); }, { 'aria-label': 'Column to search' }),
      el('input', { type: 'text', value: f.find ?? '', placeholder: 'Find', 'aria-label': 'Find', oninput: (e) => { f.find = e.target.value; recount(); } }),
      el('input', { type: 'text', value: f.replaceWith ?? '', placeholder: 'Replace with', 'aria-label': 'Replace with', oninput: (e) => { f.replaceWith = e.target.value; } }),
      select([{ value: 'exact', label: 'whole value' }, { value: 'contains', label: 'anywhere in the value' }], match, (v) => { f.replMatch = v; render(); }, { 'aria-label': 'Match' }),
      el('button', { class: 'btn primary small', type: 'button', onclick: () => addStep({ op: 'replace', column, find: f.find ?? '', replace: f.replaceWith ?? '', match }) }, 'Replace')),
    count);
}

function splitCard() {
  const f = state.clean;
  const names = cols().filter((c) => c.type === 'category' || c.type === 'text').map((c) => c.name);
  if (!names.length) return null;
  const column = names.includes(f.splitCol) ? f.splitCol : (f.splitCol = names[0]);
  const by = f.splitBy ?? ',';
  const note = el('span', { class: 'muted small' });
  const describe = () => {
    const n = splitCount(cols()[colIndex(column)], f.splitBy ?? ',');
    note.textContent = n >= 2 ? `Makes ${n} new columns next to ${column}.` : 'No value contains that separator yet.';
  };
  describe();
  return actionCard('Split a column', null, 'Break values like "London, UK" or "Smith; John" into separate columns. The original column stays.',
    el('div', { class: 'form-row' },
      select(names.map((n) => ({ value: n, label: n })), column, (v) => { f.splitCol = v; render(); }, { 'aria-label': 'Column to split' }),
      el('label', { class: 'muted small' }, 'on'),
      el('input', { type: 'text', class: 'narrow', value: by, 'aria-label': 'Separator', oninput: (e) => { f.splitBy = e.target.value; describe(); } }),
      el('button', { class: 'btn primary small', type: 'button', onclick: () => addStep({ op: 'split', column, by: f.splitBy ?? ',' }) }, 'Split')),
    note);
}

function groupCard() {
  const f = state.clean;
  const ds = state.dataset;
  const options = cols().filter((c) => c.type === 'number' || c.type === 'category').map((c) => c.name);
  if (!options.length) return null;
  const column = options.includes(f.groupCol) ? f.groupCol : (f.groupCol = options[0]);
  const col = cols()[colIndex(column)];
  const isNumber = col.type === 'number';
  let hint = '';
  if (isNumber) {
    const present = col.values.filter((v) => v != null);
    if (present.length) {
      const [lo, hi] = extent(present);
      hint = `Automatic size: ${formatNumber(niceBinSize(lo, hi))}`;
    }
  }
  const name = f.groupName?.trim() || uniqueName(ds, isNumber ? `${column} range` : `${column} (top ${f.groupKeep || 5})`);
  return actionCard('Group values', null, isNumber
    ? 'Turn exact numbers into ranges such as "20 – 30", so you can count and compare groups (e.g. age bands or order sizes).'
    : 'Keep the most common values and put the rest under "Other", so charts and summaries stay readable.',
    el('div', { class: 'form-row' },
      select(options.map((n) => ({ value: n, label: n })), column, (v) => { f.groupCol = v; f.groupName = ''; render(); }, { 'aria-label': 'Column to group' }),
      isNumber
        ? el('input', { type: 'number', class: 'narrow', min: '0', step: 'any', value: f.groupSize ?? '', placeholder: 'size', title: hint, 'aria-label': 'Range size', oninput: (e) => { f.groupSize = e.target.value; } })
        : el('label', { class: 'muted small' }, 'keep top ', el('input', { type: 'number', class: 'narrow', min: '1', value: f.groupKeep ?? 5, 'aria-label': 'How many values to keep', onchange: (e) => { f.groupKeep = e.target.value; render(); } })),
      el('input', { type: 'text', value: f.groupName ?? '', placeholder: name, 'aria-label': 'New column name', oninput: (e) => { f.groupName = e.target.value; } }),
      el('button', { class: 'btn primary small', type: 'button', onclick: () => {
        const step = isNumber
          ? { op: 'group', column, name, method: 'bins', ...(Number(f.groupSize) > 0 ? { size: Number(f.groupSize) } : {}) }
          : { op: 'group', column, name, method: 'top', keep: Number(f.groupKeep) || 5 };
        f.groupName = '';
        addStep(step);
      } }, 'Add column')),
    hint && el('span', { class: 'muted small' }, `${hint}. Leave the size empty to use it.`));
}

function datePartsCard() {
  const f = state.clean;
  const ds = state.dataset;
  const dates = cols().filter((c) => c.type === 'date').map((c) => c.name);
  if (!dates.length) return null;
  const column = dates.includes(f.dateCol) ? f.dateCol : (f.dateCol = dates[0]);
  const part = DATE_PARTS[f.datePart] ? f.datePart : (f.datePart = 'month');
  const name = uniqueName(ds, `${column} ${DATE_PARTS[part].label.toLowerCase()}`);
  return actionCard('Date parts', null, 'Pull out the month, weekday, quarter or year as its own column, to compare "Mondays vs Fridays" or "Q1 vs Q2".',
    el('div', { class: 'form-row' },
      select(dates.map((n) => ({ value: n, label: n })), column, (v) => { f.dateCol = v; render(); }, { 'aria-label': 'Date column' }),
      select(Object.entries(DATE_PARTS).map(([value, p]) => ({ value, label: p.label })), part, (v) => { f.datePart = v; render(); }, { 'aria-label': 'Part of the date' }),
      el('button', { class: 'btn primary small', type: 'button', onclick: () => addStep({ op: 'dateParts', column, part, name }) }, `Add "${name}"`)));
}

// ---------- step history and recipes ----------

function removeStep(k) {
  const step = state.steps[k];
  const rest = state.steps.filter((_, j) => j !== k);
  if (step.op === 'rename') renameInReport(step.to, step.column);
  const ok = setSteps(rest, step.op === 'rename' ? { [step.to]: step.column } : {},
    (message) => `Can't remove "${describeStep(step)}": a later step depends on it. ${message}`);
  if (ok) toast(`Removed: ${describeStep(step)}`, 'info');
  else if (step.op === 'rename') renameInReport(step.column, step.to);
}

function applyRecipe(recipe) {
  const { missing } = recipeFits(recipe, state.dataset);
  if (missing.length) {
    toast(`This recipe needs column${missing.length > 1 ? 's' : ''} ${missing.join(', ')}, which ${missing.length > 1 ? "aren't" : "isn't"} in this file.`);
    return;
  }
  const renames = Object.fromEntries(recipe.steps.filter((s) => s.op === 'rename').map((s) => [s.column, s.to]));
  if (setSteps([...state.steps, ...recipeSteps(recipe, state.dataset)], renames)) {
    toast(`✓ Applied ${plural(recipe.steps.length, 'cleaning step')} from “${recipe.source}”.`, 'info');
  }
}

function saveRecipeFile() {
  const recipe = makeRecipe(state.steps, state.original.name, state.original);
  const name = state.original.name.replace(/[^\w\- ]+/g, '').trim() || 'cleaning';
  download(`${name} recipe.json`, JSON.stringify(recipe, null, 2), 'application/json');
  toast(recipe.skipped
    ? `Recipe saved. ${plural(recipe.skipped, 'step')} that added another file’s data ${recipe.skipped === 1 ? 'was' : 'were'} left out.`
    : 'Recipe saved. Apply it to another file from the Clean tab.', 'info');
}

function pickRecipeFile() {
  const input = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.remove();
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (!isRecipe(json)) throw new Error('it isn’t a Lumora cleaning recipe');
      applyRecipe(json);
    } catch (err) {
      toast(`Couldn't use ${file.name}: ${err.message}`);
    }
  });
  document.body.append(input);
  input.click();
}

function recipeBanner() {
  const r = state.recipeOffer;
  if (!r) return null;
  return el('div', { class: 'recipe-banner card' },
    el('span', { class: 'insight-icon', 'aria-hidden': 'true' }, '↻'),
    el('div', { class: 'grow' },
      el('strong', {}, `Clean this file the same way as “${r.source}”?`),
      el('p', { class: 'muted small' }, `It has every column your last cleaning recipe uses. ${plural(r.steps.length, 'step')}: ${r.steps.slice(0, 3).map(describeStep).join('; ')}${r.steps.length > 3 ? '; …' : ''}`)),
    el('div', { class: 'banner-actions' },
      el('button', { class: 'btn primary small', type: 'button', onclick: () => applyRecipe(r) }, 'Apply recipe'),
      el('button', { class: 'btn ghost small', type: 'button', onclick: () => { state.recipeOffer = null; render(); } }, 'No thanks')));
}

// ---------- combine ----------

/** Pick a file from disk, read it in the background, and return its dataset. */
function pickDataFile() {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept: '.csv,.tsv,.txt,.json,.xlsx,.xlsm', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return resolve(null);
      const r = await readFile(file, { allowProject: false });
      resolve(r?.dataset ?? null);
    });
    document.body.append(input);
    input.click();
  });
}

function combineCard() {
  return actionCard('Combine with another file', 'combine', 'Bring in data from a second file: stack more rows (e.g. February under January), or add columns by matching a shared column (e.g. customer details onto orders).',
    el('div', { class: 'form-row' },
      el('button', { class: 'btn primary small', type: 'button', onclick: async () => { const other = await pickDataFile(); if (other) appendDialog(rawTable(other)); } }, '+ Add rows (stack files)'),
      el('button', { class: 'btn primary small', type: 'button', onclick: async () => { const other = await pickDataFile(); if (other) joinDialog(rawTable(other)); } }, '+ Add columns (join on a shared column)')));
}

function appendDialog(other) {
  const m = matchColumns(cols().map((c) => c.name), other.headers);
  const opts = { source: true };
  const list = (names) => names.map((n) => el('code', {}, n)).reduce((acc, x, i) => (i ? [...acc, ', ', x] : [x]), []);
  openDialog(`Add rows from ${other.name}`,
    el('p', {}, `${plural(other.rows.length, 'row')} will be added under your ${plural(state.dataset.rowCount, 'row')}.`),
    el('ul', { class: 'match-list' },
      el('li', { class: 'ok' }, `✓ ${plural(m.matched.length, 'column')} match by name: `, list(m.matched)),
      m.onlyOther.length > 0 && el('li', { class: 'warn' }, `+ Only in ${other.name} (kept, blank for your current rows): `, list(m.onlyOther)),
      m.onlyBase.length > 0 && el('li', { class: 'warn' }, `○ Only in your current data (blank for the new rows): `, list(m.onlyBase))),
    !m.matched.length && el('p', { class: 'pill warn' }, 'No column names match, so the files may not belong together. Did you mean to add columns (join) instead?'),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: true, onchange: (e) => { opts.source = e.target.checked; } }), ' Add a "source" column that shows which file each row came from'),
    el('div', { class: 'dialog-actions' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => { $dialog.close(); addStep({ op: 'append', data: other, sourceColumn: opts.source ? 'source' : null, baseLabel: state.original.name }); } }, 'Add rows'),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => $dialog.close() }, 'Cancel')));
}

const JOIN_TYPES = [
  ['left', 'Keep all my rows', 'Rows without a match get blank values for the new columns. Usually what you want.'],
  ['inner', 'Only rows that match', 'Rows without a match in the other file are removed.'],
  ['full', 'All rows from both files', 'Unmatched rows from the other file are added too.'],
];

function joinDialog(other) {
  const c = cols();
  const guess = suggestJoinKeys(state.dataset, other);
  const opts = { leftKey: guess?.leftKey ?? c[0].name, rightKey: guess?.rightKey ?? other.headers[0], how: 'left' };
  const preview = el('div', { class: 'join-preview' });
  const drawPreview = () => {
    const p = previewJoin(state.dataset, other, opts);
    clear(preview);
    if (!p) return;
    const pctMatched = p.leftRows ? Math.round((p.matchedLeft / p.leftRows) * 100) : 0;
    // Native append() would print `false` for skipped lines, so drop them first.
    preview.append(...[
      el('p', { class: pctMatched >= 50 ? 'ok' : 'warn' }, el('strong', {}, `${pctMatched}%`), ` of your rows find a match (${p.matchedLeft.toLocaleString('en-US')} of ${p.leftRows.toLocaleString('en-US')}).`),
      p.unmatchedRight > 0 && el('p', { class: 'muted' }, `${plural(p.unmatchedRight, 'row')} in ${other.name} ${p.unmatchedRight === 1 ? 'matches' : 'match'} none of yours.`),
      p.duplicateKeys > 0 && el('p', { class: 'warn' }, `⚠ ${plural(p.duplicateKeys, 'value')} appear more than once in ${other.name}, so matching rows will be repeated (one copy per match).`),
      el('p', {}, 'Result: ', el('strong', {}, plural(p.resultRows, 'row')), ` × ${plural(c.length + other.headers.length - 1, 'column')}.`),
      pctMatched === 0 && el('p', { class: 'pill warn' }, 'Nothing matches. Check that you picked the right columns.'),
    ].filter(Boolean));
  };
  openDialog(`Add columns from ${other.name}`,
    el('p', { class: 'muted' }, 'Rows are matched where these two columns have the same value (ignoring upper/lower case and extra spaces).'),
    el('div', { class: 'join-keys' },
      field('Your column', select(c.map((col) => ({ value: col.name, label: col.name })), opts.leftKey, (v) => { opts.leftKey = v; drawPreview(); })),
      el('span', { class: 'join-eq', 'aria-hidden': 'true' }, '='),
      field(`Column in ${other.name}`, select(other.headers.map((h) => ({ value: h, label: h })), opts.rightKey, (v) => { opts.rightKey = v; drawPreview(); }))),
    el('fieldset', { class: 'join-types' },
      el('legend', {}, 'Which rows to keep?'),
      JOIN_TYPES.map(([value, label, help]) => el('label', { class: 'radio' },
        el('input', { type: 'radio', name: 'join-how', value, checked: value === opts.how, onchange: () => { opts.how = value; drawPreview(); } }),
        el('span', {}, el('strong', {}, label), el('span', { class: 'muted small' }, ` · ${help}`))))),
    preview,
    el('div', { class: 'dialog-actions' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => { $dialog.close(); addStep({ op: 'join', data: other, leftKey: opts.leftKey, rightKey: opts.rightKey, how: opts.how }); } }, 'Add columns'),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => $dialog.close() }, 'Cancel')));
  drawPreview();
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
const chartRefs = (ch, type) => ({ type: type ?? ch.type, x: nameOf(ch.x), y: nameOf(ch.y), agg: ch.agg, color: nameOf(ch.color), forecast: ch.forecast ?? null, filters: filterRefs(state.filters) });
const summarizeRefs = (s) => ({ by: nameOf(s.by), dateUnit: s.dateUnit, cols: nameOf(s.cols), colUnit: s.colUnit ?? 'month', aggs: s.aggs.map((a) => ({ fn: a.fn, column: nameOf(a.column) })), sort: s.sort ?? null, limit: s.limit ?? null, filters: filterRefs(state.filters) });

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
  if (view.chart) state.chart = { type: view.chart.type ?? 'auto', x: idxOf(view.chart.x) ?? 0, y: idxOf(view.chart.y), agg: view.chart.agg ?? 'mean', color: idxOf(view.chart.color), forecast: view.chart.forecast ?? null };
  if (view.summarize?.by) {
    state.summarize = {
      by: idxOf(view.summarize.by) ?? 0,
      dateUnit: view.summarize.dateUnit ?? 'month',
      cols: idxOf(view.summarize.cols),
      colUnit: view.summarize.colUnit ?? 'month',
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

// Very large datasets are not auto-saved: copying millions of cells into storage would
// freeze the page. "Save project" still downloads a complete file.
const AUTOSAVE_CELL_LIMIT = 3_000_000;
let lastSavedData = { id: null, original: null, steps: null };
let warnedTooBig = false;

function cellCount() {
  let n = state.original.rowCount * state.original.columns.length;
  for (const s of state.steps) if (s.data) n += s.data.rows.length * s.data.headers.length;
  return n;
}

async function saveNow() {
  clearTimeout(saveTimer);
  if (!state.dataset || !state.projectId) return;
  if (cellCount() > AUTOSAVE_CELL_LIMIT) {
    store.set('openProject', null);
    if (!warnedTooBig) {
      warnedTooBig = true;
      toast('This dataset is very large, so it isn’t saved automatically. Use “Save project” to keep a copy.', 'info');
    }
    return;
  }
  const args = { id: state.projectId, original: state.original, steps: state.steps, view: viewByNames(), report: state.report, appVersion: VERSION };
  const meta = { ...serializeProject({ ...args, includeData: false }), steps: undefined, stepCount: state.steps.length };
  // Rows and steps are written only when they changed; settings and report every time.
  const dataChanged = lastSavedData.id !== state.projectId || lastSavedData.original !== state.original || lastSavedData.steps !== state.steps;
  const data = dataChanged ? { data: serializeProject(args).data, steps: state.steps } : null;
  try {
    await saveProject(meta, data);
    if (dataChanged) lastSavedData = { id: state.projectId, original: state.original, steps: state.steps };
  } catch {
    /* storage full or unavailable: the app keeps working; "Save project" still downloads a file */
  }
}

function openProject(json, { imported = false } = {}) {
  const p = deserializeProject(json);
  state.page = null;
  state.original = p.original;
  state.steps = p.steps;
  state.dataset = p.dataset;
  state.projectId = imported ? newProjectId() : p.id ?? newProjectId();
  state.report = p.report;
  state.clean = {};
  state.addingFilter = null;
  state.recipeOffer = null;
  chooseDefaults();
  state.tab = 'overview';
  restoreView(p.view);
  store.set('openProject', state.projectId);
  warnedTooBig = false;
  // Opened from this browser's storage: its data is already saved.
  lastSavedData = imported ? { id: null } : { id: state.projectId, original: state.original, steps: state.steps };
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
    let data = buildChartData(state.dataset, rows, { ...r.chart, forecast: null, agg: 'mean' });
    if (r.chart.forecast && data.unit) data = buildChartData(state.dataset, rows, { ...r.chart, agg: 'mean', forecast: DEFAULT_HORIZON[data.unit] });
    body = data.error ? el('p', {}, data.error) : [el('div', { class: 'chart-wrap' }, renderChart(data)), chartNotes(data)];
    actions.push(['Open in Chart builder', () => { adoptFilters(); state.chart = { type: r.chart.type, x: r.chart.x, y: r.chart.y, agg: 'mean', color: null, forecast: r.chart.forecast ?? null }; state.tab = 'chart'; update(); }]);
    actions.push(['📌 Add to report', () => pin({ kind: 'chart', title: parsed.understood, chart: { type: r.chart.type, x: nameOf(r.chart.x), y: nameOf(r.chart.y), agg: 'mean', color: null, filters: filterRefs([...state.filters, ...parsed.filters]) } })]);
  } else if (r.type === 'drivers') {
    const list = keyDrivers(state.dataset, analysisRows(rows), r.target).slice(0, 3);
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
  const list = memo(indices, `drivers:${t}`, () => keyDrivers(state.dataset, analysisRows(indices), t));
  const max = Math.max(0.0001, ...list.map((d) => d.strength));

  return el('div', { class: 'drivers-view' },
    el('div', { class: 'card drivers-controls' },
      el('label', { class: 'drivers-question' },
        el('span', {}, 'What is most related to'),
        select(targets.map(({ col, i }) => ({ value: i, label: col.name })), t, (v) => { state.drivers.target = +v; update(); }, { 'aria-label': 'Column to explain' }),
        el('span', {}, '?')),
      el('button', { class: 'btn small primary', type: 'button', onclick: () => pin({ kind: 'drivers', title: `What is related to ${c[t].name}`, drivers: { target: c[t].name, filters: filterRefs(state.filters) } }) }, '📌 Add to report')),
    learnTip('drivers'),
    sampleNote(),
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
      const data = buildChartData(state.dataset, rows, { type, x, y, agg: ch.agg, color: idxOf(ch.color), forecast: ch.forecast ?? null });
      content = data.error ? el('p', { class: 'muted' }, data.error) : [el('div', { class: 'chart-wrap' }, renderChart(data)), chartNotes(data)];
    }
  } else if (item.kind === 'summary') {
    const s = item.summarize;
    missing = missing.concat(missingCols([s.by, s.cols, ...s.aggs.map((a) => a.column)]));
    if (!missing.length && s.cols) {
      const a = s.aggs[0];
      content = renderPivot(pivotTable(state.dataset, rows, { rows: idxOf(s.by), rowUnit: s.dateUnit, columns: idxOf(s.cols), colUnit: s.colUnit, fn: a.fn, column: idxOf(a.column) }));
    } else if (!missing.length) {
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
  } else if (item.kind === 'analysis') {
    content = analysesUI.renderReportItem(item.analysis, rows);
  } else if (item.kind === 'drivers') {
    missing = missing.concat(missingCols([item.drivers.target]));
    if (!missing.length) {
      const list = keyDrivers(state.dataset, analysisRows(rows), idxOf(item.drivers.target)).slice(0, 5);
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
        el('button', { class: 'btn small primary', type: 'button', disabled: !state.report.length, onclick: printReport }, '🖨 Print / Save as PDF'))),
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

/**
 * Describe the focused control so the same control can be focused again after a re-render
 * (otherwise keyboard and screen-reader users are thrown back to the top of the page).
 */
function focusKey() {
  const a = document.activeElement;
  if (!a || a === document.body || !$app.contains(a)) return null;
  if (a.id) return { selector: `#${CSS.escape(a.id)}` };
  const label = a.getAttribute('aria-label');
  if (label) return { selector: `${a.tagName.toLowerCase()}[aria-label="${CSS.escape(label)}"]` };
  if (a.tagName === 'BUTTON') return { selector: 'button', text: a.textContent.trim() };
  return null;
}

function restoreFocus(key) {
  if (!key || (document.activeElement && document.activeElement !== document.body)) return;
  const matches = [...$app.querySelectorAll(key.selector)];
  const target = key.text == null ? matches[0] : matches.find((n) => n.textContent.trim() === key.text);
  target?.focus({ preventScroll: true });
}

function render() {
  const scrollY = window.scrollY;
  const focus = focusKey();
  const loaded = !!state.dataset && !state.page;
  $name.textContent = loaded ? state.dataset.name : state.page === 'forms' ? 'Form maker' : '';
  $name.hidden = !loaded && state.page !== 'forms';
  document.getElementById('home-btn').hidden = !loaded && !state.page;
  document.getElementById('save-btn').hidden = !loaded;
  let view;
  if (state.page === 'forms') view = formsUI.render();
  else if (state.page === 'respond') view = formsUI.renderRespond();
  else view = loaded ? renderWorkspace() : renderHome();
  clear($app).append(view);
  window.scrollTo(0, scrollY);
  restoreFocus(focus);
}

// ---------- form maker ----------

const formsUI = createFormsUI({
  toast,
  plural,
  openDialog,
  closeDialog: () => $dialog.close(),
  rerender: () => render(),
  analyze: (ds) => {
    if (!ds.rowCount) {
      toast('There are no responses to analyse yet.');
      return;
    }
    loadDataset(ds);
    toast(`Analysing ${plural(ds.rowCount, 'response')} to “${ds.name}”.`, 'info');
  },
  leave: () => leaveRespondPage(),
  showForms: () => {
    state.page = 'forms';
    render();
  },
});

function openFormMaker() {
  state.page = 'forms';
  formsUI.openList();
  render();
  window.scrollTo(0, 0);
}

function leaveRespondPage() {
  if (location.hash.startsWith('#form=')) history.replaceState(null, '', location.pathname + location.search);
  state.page = null;
  render();
}

function openSharedFormFromHash() {
  if (!location.hash.startsWith('#form=')) return false;
  formsUI.openRespondFromLink(location.hash.slice('#form='.length));
  state.page = 'respond';
  render();
  window.scrollTo(0, 0);
  return true;
}
window.addEventListener('hashchange', openSharedFormFromHash);

document.getElementById('open-btn').addEventListener('click', () => $fileInput.click());
document.getElementById('save-btn').addEventListener('click', saveProjectFile);
document.getElementById('home-btn').addEventListener('click', async () => {
  if (state.page) {
    // From the form maker or a shared form, go back to the data (or the start screen).
    if (state.page === 'respond') leaveRespondPage();
    else {
      state.page = null;
      render();
    }
    return;
  }
  await saveNow();
  state.dataset = null;
  store.set('openProject', null);
  // Back on the start screen nothing can be lost, so a waiting update installs now.
  if (pendingUpdate) pendingUpdate();
  else render();
});
$fileInput.addEventListener('change', () => {
  loadFiles($fileInput.files);
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
  if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
});
window.addEventListener('paste', (e) => {
  if (state.dataset || e.target.closest?.('input, textarea')) return;
  const text = e.clipboardData?.getData('text');
  if (text && text.includes('\n')) loadText(text, 'pasted data.csv');
});

// ---------- command palette (Ctrl+K) ----------

function goTab(tab) {
  state.tab = tab;
  render();
  window.scrollTo(0, 0);
}

function paletteCommands() {
  const cmds = [];
  const add = (group, icon, title, run, keywords) => cmds.push({ group, icon, title, run, keywords });
  if (state.dataset) {
    const ds = state.dataset;
    TABS.forEach((t) => add('Go to', t.icon, t.label, () => goTab(t.id), `tab ${t.id}`));
    add('Action', '?', 'Ask a question about the data', () => { goTab('overview'); document.querySelector('.ask-input')?.focus(); }, 'ask plain english');
    add('Action', '+', 'Add a filter', () => {
      if (['learn', 'report'].includes(state.tab)) state.tab = 'table';
      state.addingFilter = { column: 0, op: FILTER_OPS[cols()[0].type][0], value: '' };
      render();
    }, 'filter rows where');
    if (state.filters.length) add('Action', '✕', 'Clear all filters', () => { state.filters = []; update(); });
    if (state.steps.length) add('Action', '↶', `Undo: ${describeStep(state.steps.at(-1))}`, undo, 'undo');
    add('Action', '♥', 'Check data health', () => goTab('clean'), 'problems issues quality fix');
    ANALYSIS_TOOLS.forEach((t) => add('Analysis', t.icon, t.question, () => openAnalysis(t.id), `analyse ${t.blurb}`));
    if (healthReady()) {
      const safe = healthIssues().filter((i) => i.safe).length;
      if (safe) add('Action', '✓', `Fix ${plural(safe, 'safe problem')}`, fixAllSafe, 'clean fix all');
    }
    add('Action', '⇩', 'Export rows to CSV', () => download(`${ds.name}${state.filters.length ? '-filtered' : ''}.csv`, datasetToCSV(ds, indices)), 'download csv');
    add('Action', '⇩', 'Export rows to Excel', () => exportExcel(`${ds.name}${state.filters.length ? ' filtered' : ''}`, [datasetSheet(ds, indices)]), 'download xlsx spreadsheet');
    add('Action', '⇩', 'Save project file', saveProjectFile, 'download lumora');
    if (state.steps.some(isPortable)) add('Action', '⇩', 'Save cleaning recipe', saveRecipeFile, 'download steps');
    add('Action', '↻', 'Apply a cleaning recipe…', pickRecipeFile, 'replay steps');
    if (state.report.length) add('Action', '🖨', 'Print or save the report as PDF', () => { goTab('report'); setTimeout(printReport, 50); }, 'pdf');
    add('Action', '⌂', 'Close this data and go to the start screen', () => document.getElementById('home-btn').click(), 'home start');
    cols().forEach((c, i) => {
      add('Column', TYPE_ICONS[c.type], `${c.name}: details`, () => openProfile(i), `profile ${TYPE_LABELS[c.type]}`);
      add('Column', '∿', `Chart ${c.name}`, () => { state.chart = { type: 'auto', x: i, y: null, agg: 'mean', color: null }; goTab('chart'); }, 'plot graph');
      add('Column', '⇅', `Sort table by ${c.name}`, () => { state.table.sort = i; state.table.dir = 'desc'; goTab('table'); }, 'order');
    });
  }
  add('App', '📂', 'Open a file', () => $fileInput.click(), 'load import csv excel');
  add('App', '📝', 'Form maker: make a form to collect data', openFormMaker, 'survey questionnaire collect sign up');
  add('App', '◐', 'Switch dark / light mode', () => $theme.click(), 'theme');
  add('App', '💡', `${state.learn ? 'Turn off' : 'Turn on'} Learn mode`, () => $learn.click(), 'explanations tips');
  add('App', '★', "What's new", () => showWhatsNew(), 'changelog version');
  SAMPLES.forEach((smp) => add('Practice data', smp.emoji, `Open practice data: ${smp.name}`, () => loadSample(smp.id), 'sample example'));
  LESSONS.forEach((l) => add('Lesson', '🎓', l.title, () => runLesson(l), `learn ${l.terms.join(' ')}`));
  return cmds;
}

function openPalette() {
  if (document.querySelector('dialog.palette')) return;
  const commands = paletteCommands();
  const dlg = el('dialog', { class: 'palette', 'aria-label': 'Search commands' });
  const input = el('input', { type: 'search', class: 'palette-input', placeholder: 'Search tabs, columns and actions…', 'aria-label': 'Search commands', autocomplete: 'off' });
  const list = el('ul', { class: 'palette-list', role: 'listbox' });
  let shown = [];
  let active = 0;
  const setActive = (k) => {
    active = k;
    [...list.children].forEach((li, j) => {
      li.classList.toggle('active', j === k);
      li.setAttribute('aria-selected', String(j === k));
    });
    list.children[k]?.scrollIntoView({ block: 'nearest' });
  };
  const run = (c) => {
    dlg.close();
    c.run();
  };
  const draw = () => {
    shown = rankCommands(commands, input.value, 40);
    clear(list).append(...shown.map((c, k) => el('li', { class: 'palette-item', role: 'option', onmousemove: () => active !== k && setActive(k), onclick: () => run(c) },
      el('span', { class: 'palette-icon', 'aria-hidden': 'true' }, c.icon),
      el('span', { class: 'palette-title' }, c.title),
      el('span', { class: 'palette-group' }, c.group))));
    if (!shown.length) list.append(el('li', { class: 'palette-empty' }, 'Nothing matches. Try another word.'));
    setActive(0);
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) setActive((active + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length);
    } else if (e.key === 'Enter' && shown[active]) {
      e.preventDefault();
      run(shown[active]);
    }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.append(input, list, el('div', { class: 'palette-hint muted small' }, '↑↓ to move · Enter to run · Esc to close'));
  document.body.append(dlg);
  dlg.showModal();
  draw();
  input.focus();
}

document.getElementById('palette-btn').addEventListener('click', openPalette);

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
    return;
  }
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
window.lumora = { state, loadText, loadSample, addStep, undo, saveNow, openFormMaker, version: VERSION };

const params = new URLSearchParams(location.search);
const reopen = store.get('openProject', null);
if (openSharedFormFromHash()) {
  // Someone opened a shared form: show only the form, not the owner's last project.
} else if (params.get('form') === 'new') openFormMaker();
else if (params.get('sample')) loadSample(params.get('sample'));
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
