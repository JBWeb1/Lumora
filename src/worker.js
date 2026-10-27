// Background loader (a Web Worker): reads and parses files off the main thread so
// the page stays responsive for files with millions of rows. See src/ui/loader.js.

import { buildDataset, datasetFromText } from './core/infer.js';
import { readXlsx } from './core/xlsx.js';
import { packDataset } from './core/pack.js';
import { overviewData } from './core/overview.js';
import { decodeText, isLumoraFile } from './core/encoding.js';

let sheets = null;
let baseName = '';
const progress = (stage, fraction) => self.postMessage({ type: 'progress', stage, fraction });

function send(dataset) {
  // Work out the Overview here too, so the page doesn't have to right after loading.
  progress('analysing', 0);
  const overview = dataset.rowCount > 20000 ? overviewData(dataset, [...Array(dataset.rowCount).keys()]) : null;
  progress('sending', 1);
  const { packed, transfer } = packDataset(dataset);
  self.postMessage({ type: 'dataset', dataset: packed, overview }, transfer);
}

function buildSheet(sheet) {
  return buildDataset(sheets.length > 1 ? `${baseName} · ${sheet.name}` : baseName, sheet.headers, sheet.rows, (f) => progress('columns', f));
}

self.onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === 'load') {
      const { file } = msg;
      baseName = file.name.replace(/\.[^.]+$/, '');
      progress('reading', 0);
      if (/\.(xlsx|xlsm)$/i.test(file.name)) {
        sheets = await readXlsx(await file.arrayBuffer());
        if (sheets.length > 1) {
          self.postMessage({ type: 'sheets', sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length, columns: s.headers.length })) });
          return;
        }
        send(buildSheet(sheets[0]));
        return;
      }
      const text = decodeText(await file.arrayBuffer());
      // Lumora's own files (projects, recipes, forms) are handled by the page.
      if (isLumoraFile(text)) {
        self.postMessage({ type: 'project', text });
        return;
      }
      send(datasetFromText(text, file.name, progress));
    } else if (msg.type === 'pickSheet') {
      send(buildSheet(sheets[msg.index]));
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
