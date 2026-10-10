// Projects: everything needed to pick up where you left off — the original data,
// the cleaning steps, filters, chart and summary settings, and the report.
// Column references are stored by name so they survive cleaning steps.

import { buildDataset } from './infer.js';
import { runRecipe } from './clean.js';

export const PROJECT_FORMAT = 'lumora-project';
export const PROJECT_SCHEMA = 1;

/**
 * Build a plain JSON-safe project object.
 * `view` holds UI settings with column references already converted to names.
 */
export function serializeProject({ id, original, steps, view, report, appVersion }) {
  return {
    format: PROJECT_FORMAT,
    schema: PROJECT_SCHEMA,
    appVersion,
    id,
    name: original.name,
    savedAt: new Date().toISOString(),
    rowCount: original.rowCount,
    data: { headers: original.columns.map((c) => c.name), rows: Array.from({ length: original.rowCount }, (_, i) => original.columns.map((c) => c.raw[i])) },
    steps,
    view,
    report,
  };
}

export function isProject(json) {
  return json && typeof json === 'object' && json.format === PROJECT_FORMAT;
}

/** Rebuild datasets from a saved project. Throws with a friendly message if it is damaged. */
export function deserializeProject(json) {
  if (!isProject(json)) throw new Error('This is not a Lumora project file.');
  if (json.schema > PROJECT_SCHEMA) throw new Error('This project was saved by a newer version of Lumora. Update Lumora to open it.');
  const { headers, rows } = json.data ?? {};
  if (!Array.isArray(headers) || !Array.isArray(rows)) throw new Error('The project file is damaged (no data found).');
  const original = buildDataset(json.name ?? 'Project', headers, rows);
  const steps = Array.isArray(json.steps) ? json.steps : [];
  let dataset;
  let skipped = 0;
  try {
    dataset = runRecipe(original, steps);
  } catch {
    // Keep as many steps as still apply rather than refusing to open the project.
    let ok = [];
    for (const step of steps) {
      try {
        runRecipe(original, [...ok, step]);
        ok = [...ok, step];
      } catch {
        skipped++;
      }
    }
    steps.length = 0;
    steps.push(...ok);
    dataset = runRecipe(original, steps);
  }
  return { id: json.id, original, dataset, steps, view: json.view ?? {}, report: Array.isArray(json.report) ? json.report : [], skippedSteps: skipped };
}

/** Short summary for the "Recent work" list. */
export function projectSummary(json) {
  return { id: json.id, name: json.name, savedAt: json.savedAt, rowCount: json.rowCount, steps: json.steps?.length ?? 0, reportItems: json.report?.length ?? 0 };
}

export function newProjectId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
