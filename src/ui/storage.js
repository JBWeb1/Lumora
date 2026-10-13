// Saves projects in the browser's IndexedDB so work survives reloads and updates.
//
// Two stores: `projects` holds the small, frequently-changing part (settings, report),
// `data` holds the rows and cleaning steps, which are rewritten only when they change.
// Every function fails softly: if storage is unavailable (private mode, quota), the
// app keeps working and simply can't remember projects.

const DB = 'lumora';
const MAX_PROJECTS = 12;

let dbPromise = null;
function open() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('Storage unavailable'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(stores, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const result = fn(...[].concat(stores).map((s) => tx.objectStore(s)));
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Storage full'));
  }));
}

/**
 * Save a project. `meta` is the project without its data; `data` ({ data, steps }) is
 * written only when given (i.e. when the rows or cleaning steps changed).
 */
export async function saveProject(meta, data = null) {
  await run(['projects', 'data'], 'readwrite', (projects, store) => {
    projects.put(meta);
    if (data) store.put({ id: meta.id, ...data });
  });
  const all = await listProjects();
  for (const old of all.slice(MAX_PROJECTS)) await deleteProject(old.id);
}

/** Load a full project (settings + data). Projects saved by older versions keep their data inline. */
export async function loadProject(id) {
  const [meta, data] = await run(['projects', 'data'], 'readonly', (projects, store) => [projects.get(id), store.get(id)])
    .then((reqs) => reqs.map((r) => r.result));
  if (!meta) return null;
  if (meta.data) return meta;
  if (!data) return null;
  return { ...meta, data: data.data, steps: data.steps };
}

export async function listProjects() {
  try {
    const all = await run('projects', 'readonly', (s) => s.getAll());
    return all.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  } catch {
    return [];
  }
}

export function deleteProject(id) {
  return run(['projects', 'data'], 'readwrite', (projects, store) => {
    projects.delete(id);
    store.delete(id);
  });
}
