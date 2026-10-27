// The Analyses tab: "What do you want to find out?" A grid of plain questions (only the
// ones that fit the data), and for each one a focused page that picks sensible settings
// itself and leads with a one-sentence answer, then a chart, then the details.
//
// The app passes in helpers (ctx):
//   dataset(), rows() (filtered row indices), sample(rows), memo(rows, key, fn), plural,
//   pin(item), addStep(step), renderDrivers(), rerender(), filterOnDate(columnName, day),
//   openChart(xName, yName)

import { el, select } from './dom.js';
import { renderChart } from './charts.js';
import { formatNumber } from '../core/transform.js';
import { compareGroups, defaultMeasure, explainChange, groupingColumns, textThemes, topContributors, unusualPoints } from '../core/analyses.js';
import { delayedEffect, findGroups, funnel, idColumns, measureColumns, nestedSteps, predictWhatIf, returnRates, trendAndPattern, whatIfModel } from '../core/analyses-more.js';

const pct = (x) => `${Math.round(x * 100)}%`;
const hasDate = (ds) => ds.columns.some((c) => c.type === 'date');
const numberNames = (ds) => ds.columns.filter((c) => c.type === 'number').map((c) => c.name);
const textColumns = (ds) => ds.columns.filter((c) => c.type === 'text' || (c.type === 'category' && c.values.slice(0, 2000).some((v) => typeof v === 'string' && v.split(/\s+/).length >= 3)));

/** Every question, in the order shown. `why(ds, rows)` returns null when it fits, or the reason it doesn't. */
export const TOOLS = [
  {
    id: 'change', icon: '↕', question: 'Why did it change?', blurb: 'Compare two periods and see which groups caused the rise or fall.',
    why: (ds) => (hasDate(ds) ? null : 'needs a date column'),
    run: (ds, rows, s) => explainChange(ds, rows, s),
  },
  {
    id: 'compare', icon: '⇄', question: 'How do two groups differ?', blurb: 'Weekends vs weekdays, this shop vs that one: every number side by side, and whether the difference is real.',
    why: (ds, rows) => (groupingColumns(ds, rows.slice(0, 20000)).length ? null : 'needs a category or yes/no column'),
    run: (ds, rows, s) => compareGroups(ds, rows, s),
  },
  {
    id: 'drivers', icon: '◎', question: 'What affects a number?', blurb: 'Rank every column by how much it is related to the one you care about.',
    why: (ds) => (ds.columns.length >= 2 ? null : 'needs at least two columns'),
  },
  {
    id: 'top', icon: '▤', question: 'What makes up most of the total?', blurb: 'Find the few products, customers or places that account for most of it (the 80/20 rule).',
    why: (ds, rows) => (groupingColumns(ds, rows.slice(0, 20000)).length || ds.columns.some((c) => c.type === 'text') ? null : 'needs a category column'),
    run: (ds, rows, s) => topContributors(ds, rows, s),
  },
  {
    id: 'unusual', icon: '⚑', question: 'Were there any unusual days?', blurb: 'Spot the days or months that don’t fit the usual pattern.',
    why: (ds) => (hasDate(ds) ? null : 'needs a date column'),
    run: (ds, rows, s) => unusualPoints(ds, rows, s),
  },
  {
    id: 'trend', icon: '∿', question: 'Is it growing, and when is it busiest?', blurb: 'Separate the long-term trend from the weekly and yearly pattern.',
    why: (ds) => (hasDate(ds) ? null : 'needs a date column'),
    run: (ds, rows, s) => trendAndPattern(ds, rows, s),
  },
  {
    id: 'whatif', icon: '⚖', question: 'What if something changes?', blurb: 'Move sliders and see the likely result, e.g. “what if it’s 5° warmer?”',
    why: (ds, rows) => (measureColumns(ds, rows).length ? null : 'needs a number column to predict'),
    run: (ds, rows, s) => whatIfModel(ds, rows, s),
  },
  {
    id: 'groups', icon: '◍', question: 'Are there natural groups?', blurb: 'Let Lumora sort rows into a few groups that are alike, and describe each.',
    why: (ds, rows) => (measureColumns(ds, rows).length >= 2 ? null : 'needs two or more number columns'),
    run: (ds, rows, s) => findGroups(ds, rows, s),
  },
  {
    id: 'delay', icon: '⏱', question: 'Does one thing affect another later?', blurb: 'Check for delayed effects, e.g. “does rain today mean fewer customers tomorrow?”',
    why: (ds, rows) => (!hasDate(ds) ? 'needs a date column' : measureColumns(ds, rows).length < 2 ? 'needs two number columns' : null),
    run: (ds, rows, s) => delayedEffect(ds, rows, s),
  },
  {
    id: 'returns', icon: '↻', question: 'Do people come back?', blurb: 'Of the customers who first appear each month, how many return later.',
    why: (ds, rows) => (!hasDate(ds) ? 'needs a date column' : idColumns(ds, rows).length ? null : 'needs a customer or member column with repeat visits'),
    run: (ds, rows, s) => returnRates(ds, rows, s),
  },
  {
    id: 'funnel', icon: '⏬', question: 'Where do people drop off?', blurb: 'Follow steps such as visited → signed up → bought, and find the biggest drop.',
    why: (ds, rows) => (nestedSteps(ds, rows).length >= 2 ? null : 'needs yes/no columns for steps that follow one another (visited → signed up → bought)'),
    run: (ds, rows, s) => funnel(ds, rows, s),
  },
  {
    id: 'themes', icon: '❝', question: 'What are people saying?', blurb: 'Common themes and the tone of written answers, such as comments or feedback.',
    why: (ds) => (textColumns(ds).length ? null : 'needs a column of written answers'),
    run: (ds, rows, s) => textThemes(ds, rows, s),
  },
];

// Heavier analyses look at an evenly spread sample of very large data.
const SAMPLED = new Set(['groups', 'whatif', 'themes', 'compare']);

export function createAnalysesUI(ctx) {
  const state = { tool: null, settings: {} };

  const settingsFor = (id) => (state.settings[id] ??= {});
  const change = (id, patch) => {
    Object.assign(settingsFor(id), patch);
    ctx.rerender();
  };

  function run(tool, settings = settingsFor(tool.id), rows = ctx.rows()) {
    const ds = ctx.dataset();
    const use = SAMPLED.has(tool.id) ? ctx.sample(rows) : rows;
    // Slider positions in what-if don't change the model, so they aren't part of the key.
    const key = JSON.stringify({ ...settings, values: undefined });
    return ctx.memo(rows, `analysis:${tool.id}:${key}`, () => tool.run(ds, use, settings));
  }

  // ---------- question grid ----------

  function availability() {
    const ds = ctx.dataset();
    const rows = ctx.rows();
    return ctx.memo(rows, 'analysis:availability', () => TOOLS.map((t) => ({ t, reason: t.why(ds, rows) })));
  }

  function renderHub() {
    const checked = availability();
    const ready = checked.filter((x) => !x.reason);
    const notReady = checked.filter((x) => x.reason);
    return el('div', { class: 'analyses-hub' },
      el('h2', {}, 'What do you want to find out?'),
      el('p', { class: 'muted' }, 'Pick a question. Lumora chooses sensible settings, answers in a sentence, and shows the chart that backs it up. You can change the settings afterwards.'),
      el('div', { class: 'question-grid' }, ready.map(({ t }) => el('button', {
        class: 'card question-card', type: 'button',
        onclick: () => { state.tool = t.id; ctx.rerender(); window.scrollTo(0, 0); },
      },
      el('span', { class: 'question-icon', 'aria-hidden': 'true' }, t.icon),
      el('strong', {}, t.question),
      el('span', { class: 'muted small' }, t.blurb)))),
      notReady.length > 0 && el('details', { class: 'not-ready' },
        el('summary', {}, `${ctx.plural(notReady.length, 'more question')} need different data`),
        el('ul', {}, notReady.map(({ t, reason }) => el('li', {}, el('strong', {}, t.question), ` ${reason}.`)))));
  }

  // ---------- one question ----------

  function control(label, options, value, onChange) {
    return el('label', { class: 'analysis-control' }, el('span', { class: 'muted small' }, label), select(options, value ?? '', onChange, { 'aria-label': label }));
  }

  const opt = (names) => names.map((n) => ({ value: n, label: n }));
  const measureOptions = (ds) => [{ value: '', label: 'Number of rows' }, ...opt(numberNames(ds))];

  function pinButton(tool, settings) {
    return el('button', {
      class: 'btn small', type: 'button',
      onclick: () => ctx.pin({ kind: 'analysis', title: tool.question, analysis: { tool: tool.id, settings: structuredClone(settings) } }),
    }, '📌 Add to report');
  }

  /** The answer, notes and chart for a result (also used for report items). */
  function resultBody(tool, r, { compact = false } = {}) {
    if (r.error) return el('div', { class: 'card empty' }, r.error);
    const notes = [r.partial, r.warning, r.caution, r.quality && `The groups are ${r.quality}.`].filter(Boolean);
    return [
      el('p', { class: 'analysis-answer' }, r.answer),
      notes.map((n) => el('p', { class: 'muted small analysis-note' }, `ⓘ ${n}`)),
      r.chart && el('div', { class: 'card chart-card' }, el('div', { class: 'chart-wrap' }, renderChart(r.chart))),
      !compact && r.patternChart && el('div', { class: 'card chart-card' }, el('h3', {}, 'The weekly pattern'), el('div', { class: 'chart-wrap' }, renderChart(r.patternChart))),
    ];
  }

  function renderTool(tool) {
    const ds = ctx.dataset();
    const s = settingsFor(tool.id);
    const head = el('div', { class: 'analysis-head' },
      el('button', { class: 'btn ghost small', type: 'button', onclick: () => { state.tool = null; ctx.rerender(); } }, '← All questions'),
      el('h2', {}, el('span', { class: 'question-icon', 'aria-hidden': 'true' }, tool.icon), tool.question));
    if (tool.id === 'drivers') return el('div', { class: 'analysis-view' }, head, ctx.renderDrivers());
    const r = run(tool);
    const controls = [];
    let details = null;

    switch (tool.id) {
      case 'change':
        if (!r.error) {
          controls.push(
            control('Measure', measureOptions(ds), s.measure === undefined ? defaultMeasure(ds) : s.measure, (v) => change('change', { measure: v || null })),
            control('Periods', [{ value: 'day', label: 'Days' }, { value: 'month', label: 'Months' }, { value: 'year', label: 'Years' }], r.unit, (v) => change('change', { unit: v, from: undefined, to: undefined })),
            control('From', r.periods.map((p) => ({ value: p.value, label: p.label })), r.from, (v) => change('change', { from: v })),
            control('To', r.periods.map((p) => ({ value: p.value, label: p.label })), r.to, (v) => change('change', { to: v })),
            r.byOptions.length > 0 && control('Break down by', opt(r.byOptions), r.by, (v) => change('change', { by: v })));
          details = r.parts.length > 0 && table([r.by, 'Before', 'After', 'Change'], r.parts.slice(0, 30).map((p) => [p.label, formatNumber(p.before), formatNumber(p.after), signedCell(p.change)]));
        }
        break;
      case 'compare':
        if (!r.error) {
          controls.push(
            control('Split by', opt(r.columnOptions), r.column, (v) => change('compare', { column: v, a: undefined, b: undefined })),
            control('Group A', opt(r.groups), r.a, (v) => change('compare', { a: v })),
            control('Group B', opt(r.groups.filter((g) => g !== r.a)), r.b, (v) => change('compare', { b: v })));
          details = r.rows.length > 0 && table(['Column', `“${r.a}” (${r.sizes[0]} rows)`, `“${r.b}” (${r.sizes[1]} rows)`, 'Difference', 'Real or luck?'],
            r.rows.map((x) => [x.column, formatNumber(x.a), formatNumber(x.b), `${signedCell(x.diff)}${x.pct != null ? ` (${x.pct > 0 ? '+' : ''}${Math.round(x.pct * 100)}%)` : ''}`, `${x.effect}, ${x.verdict}`]));
        }
        break;
      case 'top':
        if (!r.error) {
          controls.push(control('Things to rank', opt(r.byOptions), r.by, (v) => change('top', { by: v })), control('Measure', measureOptions(ds), s.measure === undefined ? defaultMeasure(ds) : s.measure, (v) => change('top', { measure: v || null })));
          details = table(['#', r.by, 'Total', 'Share', 'Running total'], r.items.slice(0, 50).map((x, k) => [k + 1, x.label, formatNumber(x.value), pct(x.share), pct(x.cumulative)]));
        }
        break;
      case 'unusual':
        controls.push(control('Measure', measureOptions(ds), s.measure === undefined ? defaultMeasure(ds) : s.measure, (v) => change('unusual', { measure: v || null })));
        if (!r.error) {
          controls.push(control('Look at', [{ value: 'day', label: 'Days' }, { value: 'month', label: 'Months' }], r.unit, (v) => change('unusual', { unit: v })));
          details = r.flagged.length > 0 && el('ul', { class: 'flag-list' }, r.flagged.slice(0, 20).map((p) => el('li', { class: 'card' },
            el('strong', {}, p.label), ` ${formatNumber(p.y)} (normal ≈ ${formatNumber(p.expected)}, ${p.score > 0 ? 'higher' : 'lower'} than usual)`,
            r.unit === 'day' && el('button', { class: 'btn ghost small', type: 'button', onclick: () => ctx.filterOnDate(ds.columns.find((c) => c.type === 'date')?.name, p.key) }, 'Show these rows →'))));
        }
        break;
      case 'trend':
        controls.push(control('Measure', measureOptions(ds), s.measure === undefined ? defaultMeasure(ds) : s.measure, (v) => change('trend', { measure: v || null })));
        break;
      case 'whatif':
        if (!r.error) {
          controls.push(control('Predict', opt(r.targetOptions), r.target, (v) => change('whatif', { target: v, inputs: undefined })));
          details = whatIfPanel(r, s);
        }
        break;
      case 'groups':
        if (!r.error) {
          controls.push(control('How many groups', [{ value: '', label: 'Let Lumora decide' }, ...[2, 3, 4, 5, 6].map((k) => ({ value: k, label: String(k) }))], s.k ?? '', (v) => change('groups', { k: v ? Number(v) : undefined })));
          details = [
            el('div', { class: 'group-cards' }, r.groups.map((g) => el('article', { class: 'card group-card' },
              el('h3', {}, el('span', { class: `legend-swatch c${g.number - 1}` }), `Group ${g.number}`),
              el('p', { class: 'muted small' }, `${g.size.toLocaleString('en-US')} rows (${pct(g.share)})`),
              el('p', {}, g.name === 'about average' ? 'About average in everything.' : `Mostly ${g.name}.`),
              el('ul', { class: 'trait-list' }, g.traits.slice(0, 4).map((t) => el('li', {}, `${t.column}: ${formatNumber(t.mean)} `, el('span', { class: 'muted small' }, `(all rows: ${formatNumber(t.overall)})`))))))),
            columnPicker('Use these number columns', r.columnOptions, r.columns, (cols) => change('groups', { columns: cols })),
            el('button', {
              class: 'btn primary small', type: 'button',
              onclick: () => ctx.addStep({ op: 'segments', name: uniqueGroupName(ds), columns: r.columns, k: r.k }),
            }, 'Save the groups as a new column'),
          ];
        }
        break;
      case 'delay':
        if (!r.error) {
          controls.push(control('Possible cause', opt(r.options), r.cause, (v) => change('delay', { cause: v })), control('Outcome', opt(r.options), r.effect, (v) => change('delay', { effect: v })));
        }
        break;
      case 'returns':
        if (!r.error) {
          controls.push(control('Who', opt(r.customerOptions), r.customer, (v) => change('returns', { customer: v })));
          const n = r.average.length;
          details = el('div', { class: 'scroll-x card' }, el('table', { class: 'data-table compact cohort-table' },
            el('thead', {}, el('tr', {}, el('th', {}, 'First seen'), el('th', { class: 'num' }, 'New'), Array.from({ length: n }, (_, k) => el('th', { class: 'num' }, `+${k + 1} mo`)))),
            el('tbody', {}, r.table.map((row) => el('tr', {}, el('td', {}, row.label), el('td', { class: 'num' }, row.size),
              row.rates.map((v) => el('td', { class: 'num heat', style: v == null ? {} : { '--heat': String(Math.min(1, v * 1.5)) } }, v == null ? '' : pct(v))))))));
        }
        break;
      case 'funnel':
        if (!r.error) details = stepEditor(r, s);
        break;
      case 'themes':
        if (!r.error) {
          controls.push(control('Answers in', opt(r.columnOptions), r.column, (v) => change('themes', { column: v })));
          details = [
            el('div', { class: 'tone-bar', role: 'img', 'aria-label': `${r.tone.positive} positive, ${r.tone.neutral} neutral, ${r.tone.negative} negative` },
              ['positive', 'neutral', 'negative'].map((k) => r.tone[k] > 0 && el('span', { class: `tone ${k}`, style: { flex: String(r.tone[k]) } }, `${pct(r.tone[k] / r.tone.total)} ${k}`))),
            el('div', { class: 'theme-list' }, r.themes.map((t) => el('details', { class: 'card theme' },
              el('summary', {}, el('strong', {}, t.term), el('span', { class: 'muted small' }, ` ${t.count} answers (${pct(t.share)})`)),
              el('ul', { class: 'quotes' }, t.examples.map((q) => el('li', {}, `“${q}”`)))))),
            r.tone.negativeExamples.length > 0 && el('details', { class: 'card theme' }, el('summary', {}, 'Examples of negative answers'), el('ul', { class: 'quotes' }, r.tone.negativeExamples.map((q) => el('li', {}, `“${q}”`)))),
          ];
        }
        break;
      default:
        break;
    }

    return el('div', { class: 'analysis-view' },
      head,
      el('p', { class: 'muted' }, tool.blurb),
      controls.length > 0 && el('div', { class: 'card analysis-controls' }, controls, !r.error && pinButton(tool, s)),
      resultBody(tool, r),
      details);
  }

  // ---------- pieces ----------

  function table(headers, rows) {
    return el('div', { class: 'scroll-x card' }, el('table', { class: 'data-table compact' },
      el('thead', {}, el('tr', {}, headers.map((h, j) => el('th', { class: j ? 'num' : '' }, h)))),
      el('tbody', {}, rows.map((row) => el('tr', {}, row.map((v, j) => el('td', { class: j ? 'num' : '' }, v)))))));
  }

  const signedCell = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${formatNumber(Math.abs(x))}`;

  function uniqueGroupName(ds) {
    let name = 'Group';
    for (let k = 2; ds.columns.some((c) => c.name === name); k++) name = `Group (${k})`;
    return name;
  }

  function columnPicker(label, options, chosen, onChange) {
    const now = new Set(chosen);
    return el('details', { class: 'column-picker' },
      el('summary', {}, `${label} (${chosen.length})`),
      el('div', { class: 'picker-options' }, options.map((n) => el('label', { class: 'q-required' },
        el('input', { type: 'checkbox', checked: now.has(n), onchange: (e) => { if (e.target.checked) now.add(n); else now.delete(n); onChange(options.filter((o) => now.has(o))); } }),
        ` ${n}`))));
  }

  function whatIfPanel(model, s) {
    const values = s.values ?? (s.values = {});
    const out = el('p', { class: 'whatif-result' });
    const update = () => {
      const p = predictWhatIf(model, values);
      out.replaceChildren(
        el('span', { class: 'muted small' }, `Likely ${model.target}`),
        el('strong', {}, formatNumber(p.value)),
        el('span', { class: 'muted small' }, `usually between ${formatNumber(p.lo)} and ${formatNumber(p.hi)} · average in your data: ${formatNumber(model.typical)}`));
    };
    const inputs = model.inputs.map((inp) => {
      const id = `whatif-${inp.name.replace(/\W+/g, '-')}`;
      let control;
      if (inp.kind === 'number') {
        const span = inp.max - inp.min || 1;
        const lo = inp.min - span * 0.25;
        const hi = inp.max + span * 0.25;
        const v = values[inp.name] ?? inp.typical;
        const shown = el('output', { for: id }, formatNumber(v));
        control = [el('input', {
          id, type: 'range', min: String(lo), max: String(hi), step: String(span / 200), value: String(v),
          oninput: (e) => { values[inp.name] = Number(e.target.value); shown.textContent = formatNumber(values[inp.name]); update(); },
        }), shown];
      } else {
        const options = inp.kind === 'yesno' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : inp.levels.map((l) => ({ value: l, label: l }));
        const v = values[inp.name] ?? (inp.kind === 'yesno' ? (inp.typical ? 'yes' : 'no') : inp.typical);
        control = select(options, v, (nv) => { values[inp.name] = nv; update(); }, { id });
      }
      return el('div', { class: 'whatif-input' }, el('label', { for: id }, inp.name), control);
    });
    update();
    return el('section', { class: 'card whatif' },
      el('h3', {}, 'Try it: change the inputs'),
      el('div', { class: 'whatif-grid' }, inputs),
      out,
      el('button', { class: 'btn ghost small', type: 'button', onclick: () => { s.values = {}; ctx.rerender(); } }, 'Reset to typical values'),
      columnPicker('Columns used to predict', model.inputOptions, model.inputs.map((i) => i.name), (cols) => change('whatif', { inputs: cols, values: {} })));
  }

  function stepEditor(r, s) {
    const steps = [...r.steps];
    const set = (next) => change('funnel', { steps: next });
    const unused = r.stepOptions.filter((n) => !steps.includes(n));
    return el('section', { class: 'card funnel-steps' },
      el('h3', {}, 'Steps, in order'),
      el('ol', {}, steps.map((n, k) => el('li', {},
        el('span', {}, n),
        el('span', { class: 'q-tools' },
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': `Move ${n} up`, disabled: k === 0, onclick: () => { [steps[k - 1], steps[k]] = [steps[k], steps[k - 1]]; set(steps); } }, '↑'),
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': `Move ${n} down`, disabled: k === steps.length - 1, onclick: () => { [steps[k + 1], steps[k]] = [steps[k], steps[k + 1]]; set(steps); } }, '↓'),
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remove ${n}`, disabled: steps.length <= 2, onclick: () => set(steps.filter((x) => x !== n)) }, '✕'))))),
      unused.length > 0 && select([{ value: '', label: '+ Add a step…' }, ...unused.map((n) => ({ value: n, label: n }))], '', (v) => v && set([...steps, v]), { 'aria-label': 'Add a step' }),
      el('p', { class: 'muted small' }, 'Each step counts the rows that reached it and every step before it.'));
  }

  return {
    render() {
      const tool = TOOLS.find((t) => t.id === state.tool);
      return tool ? renderTool(tool) : renderHub();
    },
    open(id) {
      state.tool = TOOLS.some((t) => t.id === id) ? id : null;
    },
    current: () => state.tool,
    /** The questions that fit the data, for shortcuts elsewhere (e.g. the Overview). */
    ready: () => availability().filter((x) => !x.reason).map((x) => x.t),
    /** A pinned analysis in the report, recomputed on the given rows. */
    renderReportItem(analysis, rows) {
      const tool = TOOLS.find((t) => t.id === analysis.tool);
      if (!tool?.run) return el('p', { class: 'muted' }, 'This analysis is no longer available.');
      return resultBody(tool, run(tool, analysis.settings ?? {}, rows), { compact: true });
    },
  };
}
