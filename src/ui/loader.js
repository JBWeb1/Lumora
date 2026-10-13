// Loads files in a background worker (src/worker.js) with progress updates.
// Falls back to loading on the page if the browser can't start a module worker.

import { unpackDatasetAsync } from '../core/pack.js';

let workerSupported = typeof Worker !== 'undefined';

/**
 * Start loading a file. Returns a controller:
 *   { promise, cancel() }
 * The promise resolves to one of
 *   { kind: 'dataset', dataset }
 *   { kind: 'sheets', sheets: [{ name, rows, columns }], pick(index) → Promise<dataset> }
 *   { kind: 'project', text }
 *   { kind: 'fallback' }   (no worker available: the caller loads on the page)
 */
export function loadFileInBackground(file, onProgress = () => {}) {
  if (!workerSupported) return { promise: Promise.resolve({ kind: 'fallback' }), cancel() {} };
  let worker;
  try {
    worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
  } catch {
    workerSupported = false;
    return { promise: Promise.resolve({ kind: 'fallback' }), cancel() {} };
  }

  let settle;
  let fail;
  let started = false;
  const finish = () => worker.terminate();
  const waitForDataset = () => new Promise((resolve, reject) => { settle = resolve; fail = reject; });

  const promise = new Promise((resolve, reject) => {
    settle = resolve;
    fail = reject;
    worker.onmessage = ({ data: msg }) => {
      started = true;
      if (msg.type === 'progress') onProgress(msg.stage, msg.fraction);
      else if (msg.type === 'error') {
        finish();
        fail(new Error(msg.message));
      } else if (msg.type === 'project') {
        finish();
        settle({ kind: 'project', text: msg.text });
      } else if (msg.type === 'dataset') {
        finish();
        unpackDatasetAsync(msg.dataset, (f) => onProgress('preparing', f))
          .then((dataset) => settle({ kind: 'dataset', dataset, overview: msg.overview }))
          .catch(fail);
      } else if (msg.type === 'sheets') {
        settle({
          kind: 'sheets',
          sheets: msg.sheets,
          pick(index) {
            const next = waitForDataset().then((r) => ({ dataset: r.dataset, overview: r.overview }));
            worker.postMessage({ type: 'pickSheet', index });
            return next;
          },
        });
      }
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      finish();
      // A worker that never started (old browser, blocked module workers) → load on the page instead.
      if (!started) {
        workerSupported = false;
        settle({ kind: 'fallback' });
      } else fail(new Error(e.message || 'The background loader stopped unexpectedly.'));
    };
  });
  worker.postMessage({ type: 'load', file });
  return {
    promise,
    cancel() {
      finish();
      fail(new Error('cancelled'));
    },
  };
}
