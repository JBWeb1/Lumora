// Saves projects in the browser's IndexedDB so work survives reloads and updates.
// Every function fails softly: if storage is unavailable (private mode, quota), the
// app keeps working and simply can't remember projects.

const DB = 'lumora';
const STORE = 'projects';
const MAX_PROJECTS = 12;

let dbPromise = null;
function open() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('Storage unavailable'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Storage full'));
  }));
}

export async function saveProject(project) {
  await run('readwrite', (s) => s.put(project));
  // Keep only the most recent projects.
  const all = await listProjects();
  for (const old of all.slice(MAX_PROJECTS)) await deleteProject(old.id);
}

export function loadProject(id) {
  return run('readonly', (s) => s.get(id));
}

export async function listProjects() {
  try {
    const all = await run('readonly', (s) => s.getAll());
    return all.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  } catch {
    return [];
  }
}

export function deleteProject(id) {
  return run('readwrite', (s) => s.delete(id));
}
