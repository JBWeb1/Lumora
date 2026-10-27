// Form maker screens: the list of forms, the builder, filling in, responses and sharing,
// plus the page someone sees when they open a shared form link.
//
// The app passes in a few helpers (ctx) so this module doesn't depend on app.js:
//   toast(message, kind), plural(n, word), rerender(), openDialog(title, ...content),
//   closeDialog(), analyze(dataset), leave() (close the respondent page), showForms()

import { el, clear, select, download } from './dom.js';
import {
  FIELD_TYPES, TEMPLATES, checkResponse, decodeForm, encodeResponse, isEmail, mergeResponses, newField, newForm, newId,
  newResponse, readResponses, responsesFile, responsesToDataset, sanitizeForm, shareLink, summarizeField,
} from '../core/forms.js';
import { datasetToCSV, formatNumber } from '../core/transform.js';
import { deleteFormRecord, listFormRecords, saveFormRecord } from './storage.js';

const RATING_SCALES = [3, 5, 7, 10];
const MANY_OPTIONS = 6; // more options than this show as a drop-down list

export function createFormsUI(ctx) {
  const ui = {
    view: 'list', // 'list' | 'form'
    tab: 'edit', // 'edit' | 'fill' | 'responses' | 'share'
    record: null, // { form, responses }
    records: null,
    fillInputs: {},
    respond: null, // { form, inputs, code, ownRecord, error }
  };
  let saveTimer = null;
  let focusAfterRender = null;

  const rerender = () => {
    ctx.rerender();
    if (focusAfterRender) {
      const node = document.querySelector(focusAfterRender);
      node?.focus();
      // A new question's placeholder label is selected, so typing replaces it.
      if (node?.matches('.q-label')) node.select();
      focusAfterRender = null;
    }
  };

  // ---------- saving ----------

  function persist({ now = false } = {}) {
    const record = ui.record;
    record.form.updated = new Date().toISOString();
    clearTimeout(saveTimer);
    const write = () => saveFormRecord(record).catch(() => ctx.toast('Couldn’t save the form in this browser (storage is full or blocked).'));
    if (now) return write();
    saveTimer = setTimeout(write, 400);
    return null;
  }

  async function refreshList() {
    ui.records = await listFormRecords();
    rerender();
  }

  // ---------- navigation ----------

  function openList() {
    ui.view = 'list';
    ui.record = null;
    ui.records = null;
    refreshList();
  }

  function openRecord(record, tab = 'edit') {
    ui.view = 'form';
    ui.record = record;
    ui.tab = tab;
    ui.fillInputs = {};
    rerender();
    window.scrollTo(0, 0);
  }

  async function create(form) {
    const record = { form, responses: [] };
    await saveFormRecord(record).catch(() => {});
    openRecord(record, 'edit');
  }

  function copyOf(form, title) {
    const copy = sanitizeForm(structuredClone(form));
    copy.id = newId('f');
    copy.title = title;
    copy.created = copy.updated = new Date().toISOString();
    return copy;
  }

  // ---------- list ----------

  function renderList() {
    if (ui.records == null) {
      refreshList();
      return el('div', { class: 'forms-page' }, el('p', { class: 'muted' }, 'Loading your forms…'));
    }
    const records = ui.records;
    return el('div', { class: 'forms-page' },
      el('section', { class: 'forms-hero' },
        el('h1', {}, 'Form maker'),
        el('p', { class: 'lead' }, 'Make your own form to collect data: surveys, sign-ups, stock counts, expense logs, daily check-ins. Fill it in here or share a link, then analyse every answer in Lumora with one click. No account and no server: answers stay on your devices unless you send them.')),
      records.length > 0 && el('section', {},
        el('h2', {}, 'Your forms'),
        el('div', { class: 'cards' }, records.map((rec) => el('article', { class: 'card form-card' },
          el('h3', {}, rec.form.title),
          el('p', { class: 'muted small' }, [ctx.plural(rec.form.fields.length, 'question'), ctx.plural(rec.responses.length, 'response')].join(' · ')),
          el('div', { class: 'form-card-actions' },
            el('button', { class: 'btn primary small', type: 'button', onclick: () => openRecord(rec, 'edit') }, 'Open'),
            el('button', { class: 'btn small', type: 'button', onclick: () => openRecord(rec, 'fill') }, 'Fill in'),
            el('button', { class: 'btn small', type: 'button', disabled: !rec.responses.length, onclick: () => ctx.analyze(responsesToDataset(rec.form, rec.responses)) }, 'Analyse'),
            el('button', { class: 'icon-btn', type: 'button', title: 'Make a copy', 'aria-label': `Copy ${rec.form.title}`, onclick: () => create(copyOf(rec.form, `${rec.form.title} (copy)`)) }, '⧉'),
            el('button', {
              class: 'icon-btn', type: 'button', title: 'Delete', 'aria-label': `Delete ${rec.form.title}`,
              onclick: async () => {
                if (!confirm(`Delete “${rec.form.title}” and its ${ctx.plural(rec.responses.length, 'response')}? This can’t be undone.`)) return;
                await deleteFormRecord(rec.form.id).catch(() => {});
                refreshList();
              },
            }, '✕')))))),
      el('section', {},
        el('h2', {}, records.length ? 'Start a new form' : 'Start from a template, or a blank form'),
        el('div', { class: 'cards' },
          el('button', { class: 'card sample', type: 'button', onclick: () => create(newForm('Untitled form', [newField('text', 'Your first question')])) },
            el('div', { class: 'emoji', 'aria-hidden': 'true' }, '＋'),
            el('h3', {}, 'Blank form'),
            el('p', { class: 'muted' }, 'Start from scratch.')),
          TEMPLATES.map((t) => el('button', { class: 'card sample', type: 'button', onclick: () => create(t.build()) },
            el('div', { class: 'emoji', 'aria-hidden': 'true' }, t.emoji),
            el('h3', {}, t.name),
            el('p', { class: 'muted' }, t.description))))),
      el('section', { class: 'steps' },
        [['1', 'Design', 'Add questions: short or long answers, numbers, dates, ratings, yes/no, one or several choices.'],
         ['2', 'Collect', 'Fill it in on this device for quick data entry, or share a link. Each person gets a short code to send back.'],
         ['3', 'Analyse', 'Answers become a dataset with the right column types, ready for charts, summaries and drivers.']]
          .map(([n, t, d]) => el('div', { class: 'step' }, el('span', { class: 'step-n' }, n), el('div', {}, el('strong', {}, t), el('p', { class: 'muted' }, d))))));
  }

  // ---------- one form ----------

  function renderForm() {
    const { form, responses } = ui.record;
    const tabs = [['edit', '✎ Edit'], ['fill', '✍ Fill in'], ['responses', `▦ Responses (${responses.length})`], ['share', '↗ Share']];
    const views = { edit: renderBuilder, fill: renderOwnerFill, responses: renderResponses, share: renderShare };
    return el('div', { class: 'forms-page' },
      el('div', { class: 'form-head' },
        el('button', { class: 'btn ghost small', type: 'button', onclick: openList }, '← All forms'),
        el('h1', {}, form.title || 'Untitled form')),
      el('nav', { class: 'tabs', role: 'tablist' }, tabs.map(([id, label]) =>
        el('button', { class: `tab${ui.tab === id ? ' active' : ''}`, role: 'tab', type: 'button', 'aria-selected': String(ui.tab === id), onclick: () => { ui.tab = id; rerender(); } }, label))),
      el('div', { class: 'view' }, views[ui.tab]()));
  }

  // ---------- builder ----------

  function renderBuilder() {
    const { form, responses } = ui.record;
    const structural = () => {
      persist();
      rerender();
    };
    return el('div', { class: 'builder' },
      el('section', { class: 'card builder-meta' },
        el('label', { class: 'field-label', for: 'form-title' }, 'Form title'),
        el('input', { id: 'form-title', class: 'form-title-input', type: 'text', value: form.title, oninput: (e) => { form.title = e.target.value; persist(); document.querySelector('.form-head h1').textContent = form.title || 'Untitled form'; } }),
        el('label', { class: 'field-label', for: 'form-desc' }, 'Description (optional)'),
        el('textarea', { id: 'form-desc', rows: 2, value: form.description, placeholder: 'Tell people what this form is for and how long it takes.', oninput: (e) => { form.description = e.target.value; persist(); } }),
        el('label', { class: 'field-label', for: 'form-reply' }, 'Send answers to (optional)'),
        el('input', {
          id: 'form-reply', type: 'email', value: form.replyTo ?? '', placeholder: 'you@example.com',
          oninput: (e) => { form.replyTo = isEmail(e.target.value) ? e.target.value.trim() : ''; persist(); },
        }),
        el('p', { class: 'muted small' }, 'People who fill in a shared link get a button that emails their answers to this address.')),
      responses.length > 0 && el('p', { class: 'note' }, `ⓘ This form already has ${ctx.plural(responses.length, 'response')}. Renaming questions or options is fine; deleting a question hides its answers.`),
      form.fields.map((q, k) => questionEditor(q, k, structural)),
      el('section', { class: 'card add-question' },
        el('h3', {}, 'Add a question'),
        el('div', { class: 'add-buttons' }, Object.entries(FIELD_TYPES).map(([type, info]) =>
          el('button', {
            class: 'btn small', type: 'button',
            onclick: () => {
              const q = newField(type);
              form.fields.push(q);
              focusAfterRender = `#label-${q.id}`;
              structural();
            },
          }, el('span', { 'aria-hidden': 'true' }, info.icon), ` ${info.label}`)))),
      el('div', { class: 'builder-footer' },
        el('button', { class: 'btn primary', type: 'button', onclick: () => { ui.tab = 'fill'; rerender(); } }, 'Preview and fill in →'),
        el('button', { class: 'btn', type: 'button', onclick: () => { ui.tab = 'share'; rerender(); } }, 'Share →')));
  }

  function questionEditor(q, k, structural) {
    const { form } = ui.record;
    const move = (d) => {
      const j = k + d;
      if (j < 0 || j >= form.fields.length) return;
      [form.fields[k], form.fields[j]] = [form.fields[j], form.fields[k]];
      structural();
    };
    const changeType = (type) => {
      q.type = type;
      if ((type === 'choice' || type === 'checkboxes') && !q.options?.length) q.options = ['Option 1', 'Option 2', 'Option 3'];
      if (type === 'rating') q.scale ??= 5;
      if (type !== 'number') {
        delete q.min;
        delete q.max;
      }
      structural();
    };
    const optionsText = (q.options ?? []).join('\n');
    return el('article', { class: 'card question-editor' },
      el('div', { class: 'q-head' },
        el('span', { class: 'q-num', 'aria-hidden': 'true' }, k + 1),
        el('input', { id: `label-${q.id}`, class: 'q-label', type: 'text', value: q.label, 'aria-label': `Question ${k + 1}`, placeholder: 'Question', oninput: (e) => { q.label = e.target.value; persist(); } }),
        select(Object.entries(FIELD_TYPES).map(([value, info]) => ({ value, label: `${info.icon}  ${info.label}` })), q.type, changeType, { 'aria-label': `Answer type for question ${k + 1}`, class: 'q-type' })),
      el('input', { class: 'q-help', type: 'text', value: q.help ?? '', placeholder: 'Help text (optional)', 'aria-label': `Help text for question ${k + 1}`, oninput: (e) => { q.help = e.target.value; persist(); } }),
      (q.type === 'choice' || q.type === 'checkboxes') && el('div', { class: 'q-options' },
        el('label', { class: 'field-label', for: `opts-${q.id}` }, 'Options, one per line'),
        el('textarea', {
          id: `opts-${q.id}`, rows: Math.min(8, Math.max(3, q.options.length)), value: optionsText,
          oninput: (e) => {
            const opts = [...new Set(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))];
            if (opts.length) q.options = opts;
            persist();
          },
        })),
      q.type === 'number' && el('div', { class: 'form-row' },
        el('label', { class: 'muted small' }, 'Lowest allowed ', el('input', { type: 'number', class: 'narrow', step: 'any', value: q.min ?? '', oninput: (e) => { if (e.target.value === '') delete q.min; else q.min = Number(e.target.value); persist(); } })),
        el('label', { class: 'muted small' }, 'Highest allowed ', el('input', { type: 'number', class: 'narrow', step: 'any', value: q.max ?? '', oninput: (e) => { if (e.target.value === '') delete q.max; else q.max = Number(e.target.value); persist(); } }))),
      q.type === 'rating' && el('div', { class: 'form-row' },
        el('label', { class: 'muted small' }, 'Scale'),
        select(RATING_SCALES.map((n) => ({ value: n, label: `1 to ${n}` })), q.scale ?? 5, (v) => { q.scale = Number(v); structural(); }, { 'aria-label': 'Rating scale' })),
      el('div', { class: 'q-foot' },
        el('label', { class: 'q-required' }, el('input', { type: 'checkbox', checked: q.required, onchange: (e) => { q.required = e.target.checked; persist(); } }), ' Required'),
        el('span', { class: 'q-tools' },
          el('button', { class: 'icon-btn', type: 'button', title: 'Move up', 'aria-label': `Move question ${k + 1} up`, disabled: k === 0, onclick: () => move(-1) }, '↑'),
          el('button', { class: 'icon-btn', type: 'button', title: 'Move down', 'aria-label': `Move question ${k + 1} down`, disabled: k === form.fields.length - 1, onclick: () => move(1) }, '↓'),
          el('button', { class: 'icon-btn', type: 'button', title: 'Duplicate', 'aria-label': `Duplicate question ${k + 1}`, onclick: () => { form.fields.splice(k + 1, 0, { ...structuredClone(q), id: newId('q') }); structural(); } }, '⧉'),
          el('button', {
            class: 'icon-btn', type: 'button', title: 'Delete', 'aria-label': `Delete question ${k + 1}`, disabled: form.fields.length === 1,
            onclick: () => { form.fields.splice(k, 1); structural(); },
          }, '✕'))));
  }

  // ---------- filling in ----------

  function fieldInput(q, inputs, id) {
    const set = (v) => { inputs[q.id] = v; };
    const v = inputs[q.id];
    const group = (type, options, isChecked, onChange) => el('div', { class: `choice-group${q.type === 'rating' ? ' rating' : ''}` },
      options.map(([value, label]) => el('label', { class: 'choice' },
        el('input', { type, name: id, value, checked: isChecked(value), onchange: (e) => onChange(value, e.target.checked) }),
        el('span', {}, label))));
    switch (q.type) {
      case 'paragraph':
        return el('textarea', { id, rows: 3, value: v ?? '', oninput: (e) => set(e.target.value) });
      case 'number':
        return el('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: v ?? '', oninput: (e) => set(e.target.value) });
      case 'email':
        return el('input', { id, type: 'email', autocomplete: 'email', value: v ?? '', oninput: (e) => set(e.target.value) });
      case 'date':
        return el('input', { id, type: 'date', value: v ?? '', oninput: (e) => set(e.target.value) });
      case 'choice':
        if (q.options.length > MANY_OPTIONS) {
          return select([{ value: '', label: 'Choose…' }, ...q.options.map((o) => ({ value: o, label: o }))], v ?? '', set, { id });
        }
        return group('radio', q.options.map((o) => [o, o]), (o) => v === o, (o) => set(o));
      case 'checkboxes':
        return group('checkbox', q.options.map((o) => [o, o]), (o) => (v ?? []).includes(o), (o, on) => {
          const now = new Set(inputs[q.id] ?? []);
          if (on) now.add(o);
          else now.delete(o);
          set([...now]);
        });
      case 'yesno':
        return group('radio', [['yes', 'Yes'], ['no', 'No']], (o) => v === o, (o) => set(o));
      case 'rating':
        return group('radio', Array.from({ length: q.scale ?? 5 }, (_, k) => [String(k + 1), String(k + 1)]), (o) => String(v) === o, (o) => set(Number(o)));
      default:
        return el('input', { id, type: 'text', value: v ?? '', oninput: (e) => set(e.target.value) });
    }
  }

  /** The fillable form. `onSubmit(values)` is called only with a valid, cleaned submission. */
  function fillForm(form, inputs, { onSubmit, submitLabel }) {
    const errorNodes = {};
    const fields = form.fields.map((q, k) => {
      const id = `fill-${q.id}`;
      errorNodes[q.id] = el('p', { class: 'field-error', id: `${id}-error`, 'aria-live': 'polite' });
      const single = !['choice', 'checkboxes', 'yesno', 'rating'].includes(q.type) || (q.type === 'choice' && q.options.length > MANY_OPTIONS);
      const input = fieldInput(q, inputs, id);
      input.setAttribute('aria-describedby', `${id}-error`);
      const title = [q.label || `Question ${k + 1}`, q.required && el('span', { class: 'req', title: 'Required' }, ' *')];
      return el('fieldset', { class: 'fill-field', 'data-field': q.id },
        single ? el('label', { class: 'fill-label', for: id }, title) : el('legend', { class: 'fill-label' }, title),
        q.help && el('p', { class: 'muted small fill-help' }, q.help),
        input,
        errorNodes[q.id]);
    });
    const formEl = el('form', {
      class: 'fill-form card', novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const result = checkResponse(form, inputs);
        for (const q of form.fields) {
          errorNodes[q.id].textContent = result.errors[q.id] ?? '';
          formEl.querySelector(`[data-field="${q.id}"]`)?.classList.toggle('has-error', Boolean(result.errors[q.id]));
        }
        if (!result.ok) {
          const first = form.fields.find((q) => result.errors[q.id]);
          formEl.querySelector(`[data-field="${first.id}"] input, [data-field="${first.id}"] textarea, [data-field="${first.id}"] select`)?.focus();
          return;
        }
        onSubmit(result.values);
      },
    },
    el('header', { class: 'fill-head' },
      el('h2', {}, form.title || 'Untitled form'),
      form.description && el('p', { class: 'muted' }, form.description),
      form.fields.some((q) => q.required) && el('p', { class: 'muted small' }, el('span', { class: 'req' }, '*'), ' Required')),
    fields,
    el('button', { class: 'btn primary', type: 'submit' }, submitLabel));
    return formEl;
  }

  function renderOwnerFill() {
    const rec = ui.record;
    return el('div', { class: 'fill-wrap' },
      el('p', { class: 'muted' }, `Each submission is saved straight away on this device: handy for data entry at a desk, a stock count or a daily log. ${ctx.plural(rec.responses.length, 'response')} so far.`),
      fillForm(rec.form, ui.fillInputs, {
        submitLabel: 'Save and start the next one',
        onSubmit: (values) => {
          rec.responses.push(newResponse(values));
          persist({ now: true });
          ui.fillInputs = {};
          ctx.toast(`✓ Saved. ${ctx.plural(rec.responses.length, 'response')} so far.`, 'info');
          focusAfterRender = '.fill-form input, .fill-form textarea, .fill-form select';
          rerender();
          window.scrollTo(0, 0);
        },
      }));
  }

  // ---------- responses ----------

  function renderResponses() {
    const rec = ui.record;
    const { form, responses } = rec;
    const dataset = () => responsesToDataset(form, responses);
    const latest = responses.slice(-25).reverse();
    const shown = form.fields.slice(0, 4);
    return el('div', { class: 'responses-view' },
      el('div', { class: 'toolbar' },
        el('strong', {}, ctx.plural(responses.length, 'response')),
        el('div', { class: 'toolbar-actions' },
          el('button', { class: 'btn primary small', type: 'button', disabled: !responses.length, onclick: () => ctx.analyze(dataset()) }, 'Analyse in Lumora →'),
          el('button', { class: 'btn small', type: 'button', onclick: openImport }, '⇪ Import answers…'),
          el('button', { class: 'btn small', type: 'button', disabled: !responses.length, onclick: () => { const ds = dataset(); download(`${form.title} responses.csv`, datasetToCSV(ds, [...Array(ds.rowCount).keys()])); } }, '⇩ CSV'),
          el('button', { class: 'btn small', type: 'button', disabled: !responses.length, title: 'A file you can import into this form on another device', onclick: () => download(`${form.title} responses.json`, JSON.stringify(responsesFile(form, responses)), 'application/json') }, '⇩ Responses file'))),
      !responses.length && el('div', { class: 'card empty-state' },
        el('p', {}, 'No responses yet.'),
        el('p', { class: 'muted' }, 'Fill the form in yourself from the “Fill in” tab, or share a link and import the answer codes people send you.')),
      responses.length > 0 && el('div', { class: 'summary-cards' }, form.fields.map((q) => summaryCard(q, summarizeField(q, responses)))),
      responses.length > 0 && el('section', {},
        el('h2', {}, responses.length > latest.length ? `Latest ${latest.length} responses` : 'All responses'),
        el('div', { class: 'table-scroll card' },
          el('table', { class: 'data-table' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Submitted'), shown.map((q) => el('th', {}, q.label)), el('th', {}, el('span', { class: 'sr-only' }, 'Delete')))),
            el('tbody', {}, latest.map((r) => el('tr', {},
              el('td', {}, new Date(r.submitted).toLocaleString()),
              shown.map((q) => el('td', {}, show(r.values?.[q.id]))),
              el('td', {}, el('button', {
                class: 'icon-btn', type: 'button', title: 'Delete this response', 'aria-label': 'Delete this response',
                onclick: () => {
                  if (!confirm('Delete this response?')) return;
                  rec.responses = rec.responses.filter((x) => x.id !== r.id);
                  persist({ now: true });
                  rerender();
                },
              }, '✕')))))))));
  }

  const show = (v) => (v == null ? '—' : Array.isArray(v) ? v.join(', ') : v === true ? 'Yes' : v === false ? 'No' : String(v));

  function summaryCard(q, s) {
    const body = [];
    if (s.mean != null) body.push(el('p', { class: 'summary-big' }, formatNumber(s.mean), el('span', { class: 'muted small' }, q.type === 'rating' ? ` / ${q.scale ?? 5} average` : ' average')));
    if (s.min != null && q.type === 'number') body.push(el('p', { class: 'muted small' }, `from ${formatNumber(s.min)} to ${formatNumber(s.max)}`));
    if (s.counts) {
      const most = Math.max(1, ...s.counts.map((c) => c.count));
      body.push(el('div', { class: 'mini-bars' }, s.counts.map((c) => el('div', { class: 'mini-bar', 'data-tip': `${c.label}: ${ctx.plural(c.count, 'answer')}` },
        el('span', { class: 'mini-label' }, c.label),
        el('span', { class: 'mini-track' }, el('span', { class: 'mini-fill', style: { width: `${(c.count / most) * 100}%` } })),
        el('span', { class: 'mini-pct' }, String(c.count))))));
    }
    if (s.latest) body.push(s.latest.length ? el('ul', { class: 'latest-answers' }, s.latest.map((a) => el('li', {}, a))) : el('p', { class: 'muted small' }, 'No answers yet.'));
    return el('article', { class: 'card summary-card' },
      el('h3', {}, el('span', { class: 'muted', 'aria-hidden': 'true' }, `${FIELD_TYPES[q.type].icon} `), q.label),
      el('p', { class: 'muted small' }, `${s.answered} of ${ctx.plural(s.total, 'response')} answered`),
      body);
  }

  function openImport() {
    const rec = ui.record;
    const box = el('textarea', { rows: 6, class: 'import-box', placeholder: 'Paste one or more answer codes here (they start with LUMORA1.), or the text of an email that contains them.' });
    const fileInput = el('input', { type: 'file', accept: '.json,.txt', multiple: true, hidden: true });
    const importText = (text) => {
      const read = readResponses(rec.form, text);
      const { responses, added } = mergeResponses(rec.responses, read.forForm);
      rec.responses = responses;
      persist({ now: true });
      const notes = [
        `${ctx.plural(added, 'new response')} added`,
        read.forForm.length > added && `${read.forForm.length - added} already imported`,
        read.otherForms && `${read.otherForms} for a different form`,
        read.broken && `${read.broken} couldn’t be read`,
      ].filter(Boolean).join(', ');
      ctx.toast(`${added ? '✓ ' : ''}${notes}.`, added || read.forForm.length ? 'info' : 'error');
      if (added) {
        ctx.closeDialog();
        rerender();
      }
    };
    fileInput.addEventListener('change', async () => {
      const texts = await Promise.all([...fileInput.files].map((file) => file.text()));
      fileInput.value = '';
      // Each file is read on its own, so several responses files can be imported at once.
      const before = rec.responses.length;
      for (const t of texts) rec.responses = mergeResponses(rec.responses, readResponses(rec.form, t).forForm).responses;
      const added = rec.responses.length - before;
      persist({ now: true });
      ctx.toast(added ? `✓ ${ctx.plural(added, 'new response')} added.` : 'No new responses for this form in those files.', added ? 'info' : 'error');
      ctx.closeDialog();
      rerender();
    });
    ctx.openDialog('Import answers',
      el('p', {}, 'When someone fills in your shared form, they get an answer code (or a responses file) to send you. Paste the codes below: you can paste a whole email with several codes at once. Answers you already have are skipped.'),
      box,
      fileInput,
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn primary small', type: 'button', onclick: () => importText(box.value) }, 'Import'),
        el('button', { class: 'btn small', type: 'button', onclick: () => fileInput.click() }, 'Choose responses files…')));
    box.focus();
  }

  // ---------- sharing ----------

  const appBase = () => `${location.origin}${location.pathname}`;
  const linksWork = () => /^https?:$/.test(location.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

  async function copyText(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      ctx.toast(`✓ ${what} copied.`, 'info');
    } catch {
      ctx.toast(`Couldn’t copy automatically. Select the ${what.toLowerCase()} and copy it by hand.`);
    }
  }

  function renderShare() {
    const { form } = ui.record;
    const link = shareLink(form, appBase());
    const mail = `mailto:?subject=${encodeURIComponent(form.title)}&body=${encodeURIComponent(`Please fill in this short form:\n\n${link}\n\nThank you!`)}`;
    return el('div', { class: 'share-view' },
      !linksWork() && el('div', { class: 'note warn' },
        el('strong', {}, 'Heads up: '),
        'this copy of Lumora runs on your own computer or as an installed app, so a link would only open here. Put Lumora online (for example on GitHub Pages, see the README) and share the link from there. You can still download the form below and send the file.'),
      el('section', { class: 'card share-card' },
        el('h3', {}, 'Share a link'),
        el('p', { class: 'muted' }, 'Anyone with the link can fill in the form on a phone or computer. The whole form is inside the link, so it doesn’t need an account or a server.'),
        el('div', { class: 'form-row' },
          el('input', { type: 'text', class: 'share-link', readonly: true, value: link, 'aria-label': 'Form link', onfocus: (e) => e.target.select() }),
          el('button', { class: 'btn primary small', type: 'button', onclick: () => copyText(link, 'Link') }, 'Copy link'),
          el('a', { class: 'btn small', href: mail }, 'Email the link')),
        link.length > 6000 && el('p', { class: 'muted small' }, 'This form is long, so its link is long too. Some email and chat apps cut very long links; if that happens, send the form file instead.')),
      el('section', { class: 'card' },
        el('h3', {}, 'How answers come back'),
        el('ol', { class: 'how-list' },
          el('li', {}, 'The person fills in the form and presses Submit.'),
          el('li', {}, form.replyTo
            ? `They get a short answer code and a button that emails it to ${form.replyTo}.`
            : 'They get a short answer code to send you (by email, chat or text). Tip: add your email under Edit → “Send answers to” and they get a one-tap email button.'),
          el('li', {}, 'Open this form’s Responses tab → Import answers, and paste the codes. Duplicates are skipped, and every answer is checked against your questions.'))),
      el('section', { class: 'card' },
        el('h3', {}, 'Or send the form as a file'),
        el('p', { class: 'muted' }, 'People open the file in Lumora (Open file) and fill it in there. Useful when links get cut off, or for offline teams.'),
        el('button', { class: 'btn small', type: 'button', onclick: () => download(`${form.title} form.json`, JSON.stringify(form, null, 2), 'application/json') }, '⇩ Download the form')));
  }

  // ---------- the page a respondent sees ----------

  function openRespond(form) {
    ui.respond = { form, inputs: {}, code: null };
    listFormRecords().then((records) => {
      const own = records.find((r) => r.form.id === form.id);
      if (own && ui.respond?.form === form) {
        ui.respond.ownRecord = own;
        rerender();
      }
    });
  }

  function openRespondFromLink(code) {
    try {
      openRespond(decodeForm(code));
    } catch (err) {
      ui.respond = { error: err.message };
    }
  }

  function renderRespond() {
    const r = ui.respond;
    if (!r || r.error) {
      return el('div', { class: 'respond-page' },
        el('section', { class: 'card fill-form' },
          el('h2', {}, 'This form couldn’t be opened'),
          el('p', { class: 'muted' }, r?.error ?? 'The link is incomplete.'),
          el('button', { class: 'btn small', type: 'button', onclick: ctx.leave }, 'Go to Lumora')));
    }
    const { form } = r;
    const own = r.ownRecord && el('div', { class: 'note' },
      'This is your own form. ',
      el('button', { class: 'link-btn', type: 'button', onclick: () => { ctx.leave(); ctx.showForms(); openRecord(r.ownRecord, 'responses'); } }, 'Open it in the form maker'),
      ' to see its responses.');
    const saveCopy = !r.ownRecord && el('button', {
      class: 'link-btn', type: 'button',
      onclick: async () => {
        ctx.leave();
        ctx.showForms();
        await create(copyOf(form, form.title));
        ctx.toast('Saved a copy to your forms. Edit it, share it, and collect your own answers.', 'info');
      },
    }, 'Make your own copy of this form');

    if (r.code) {
      const mail = form.replyTo && `mailto:${encodeURIComponent(form.replyTo)}?subject=${encodeURIComponent(`Answers: ${form.title}`)}&body=${encodeURIComponent(`Here are my answers to “${form.title}”:\n\n${r.code}\n\n(Import this code in Lumora → Responses → Import answers.)`)}`;
      return el('div', { class: 'respond-page' },
        el('section', { class: 'card fill-form thanks' },
          el('h2', {}, '✓ Thank you! One last step'),
          el('p', {}, 'Your answers are ready but haven’t been sent yet. Send them to whoever shared this form with you:'),
          mail
            ? el('a', { class: 'btn primary', href: mail }, `Email my answers to ${form.replyTo}`)
            : null,
          el('label', { class: 'field-label', for: 'answer-code' }, mail ? 'Or copy your answer code and send it another way' : 'Your answer code'),
          el('textarea', { id: 'answer-code', class: 'answer-code', rows: 4, readonly: true, value: r.code, onfocus: (e) => e.target.select() }),
          el('div', { class: 'dialog-actions' },
            el('button', { class: mail ? 'btn small' : 'btn primary small', type: 'button', onclick: () => copyText(r.code, 'Answer code') }, 'Copy code'),
            el('button', { class: 'btn small', type: 'button', onclick: () => download(`${form.title} my answers.json`, JSON.stringify(responsesFile(form, [r.response])), 'application/json') }, '⇩ Save as a file'),
            el('button', { class: 'btn ghost small', type: 'button', onclick: () => { r.code = null; r.response = null; r.inputs = {}; rerender(); window.scrollTo(0, 0); } }, 'Fill in again')),
          el('p', { class: 'muted small' }, 'Nothing was uploaded: your answers stay on this device until you send them.')),
        own);
    }
    return el('div', { class: 'respond-page' },
      own,
      fillForm(form, r.inputs, {
        submitLabel: 'Submit',
        onSubmit: (values) => {
          r.response = newResponse(values);
          r.code = encodeResponse(form, r.response);
          rerender();
          window.scrollTo(0, 0);
        },
      }),
      el('p', { class: 'muted small respond-foot' }, 'Made with Lumora, free data analysis that runs on your device. ', saveCopy));
  }

  /** A form file opened with "Open file": fill it in, or open it if it's one of yours. */
  function openFormFile(json) {
    openRespond(sanitizeForm(json));
  }

  return {
    render: () => (ui.view === 'form' && ui.record ? renderForm() : renderList()),
    renderRespond,
    openList,
    openRespondFromLink,
    openFormFile,
    newFormFromTemplate: (id) => create((TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]).build()),
  };
}
