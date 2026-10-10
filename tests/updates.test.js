import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { VERSION, CHANGELOG } from '../src/version.js';
import { compareVersions } from '../src/ui/updates.js';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');
const swSource = read('sw.js');
const swVersion = /const VERSION = '([^']+)'/.exec(swSource)[1];
const appFiles = JSON.parse(/const APP_FILES = (\[[\s\S]*?\]);/.exec(swSource)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));

function walk(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

test('every version number agrees (a release must bump all of them)', () => {
  const pkg = JSON.parse(read('package.json')).version;
  assert.equal(VERSION, pkg, 'src/version.js vs package.json');
  assert.equal(swVersion, pkg, 'sw.js vs package.json: installed copies only update when sw.js changes');
  assert.equal(CHANGELOG[0].version, pkg, 'add release notes for the new version to src/version.js');
});

test('changelog is newest-first with unique versions and notes', () => {
  for (let i = 1; i < CHANGELOG.length; i++) assert.equal(compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version), 1);
  for (const c of CHANGELOG) {
    assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(c.items.length > 0);
  }
});

test('the offline cache lists every app file, and every listed file exists', () => {
  const needed = ['index.html', 'styles.css', 'manifest.webmanifest', ...walk('src'), ...walk('assets')];
  for (const f of needed) assert.ok(appFiles.includes(`./${f}`), `sw.js APP_FILES is missing ./${f}, so the app would break offline`);
  for (const f of appFiles) if (f !== './') assert.ok(existsSync(join(root, f)), `sw.js lists ${f}, which does not exist`);
});

test('manifest is valid and its icons exist', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'Lumora');
  for (const icon of m.icons) assert.ok(existsSync(join(root, icon.src)), icon.src);
});

test('compareVersions orders numerically', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.2.1', '0.3.0'), -1);
});

// ---------- run sw.js against fake browser APIs ----------

function loadWorker(existingCaches = {}) {
  const handlers = {};
  const store = new Map(Object.entries(existingCaches).map(([k, v]) => [k, new Map(v)]));
  const fetched = [];
  // The fake cache keys by app-relative path, like the real one does after URL resolution.
  const keyOf = (r) => (typeof r === 'string' ? r : r.url).replace('https://app.test/', './');
  const caches = {
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const c = store.get(name);
      return {
        async addAll(reqs) { for (const r of reqs) c.set(keyOf(r), `body of ${keyOf(r)}`); },
        async match(r) { return c.get(keyOf(r).replace(/\?.*$/, '')) ?? undefined; },
      };
    },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
  };
  let skipped = false;
  let claimed = false;
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => { skipped = true; },
    clients: { claim: async () => { claimed = true; } },
    location: { origin: 'https://app.test' },
  };
  vm.runInNewContext(swSource, {
    self, caches, URL,
    Request: class { constructor(url, opts) { this.url = url; this.opts = opts; } },
    fetch: async (r) => { fetched.push(keyOf(r)); return `network ${keyOf(r)}`; },
  });
  const run = async (type, extra = {}) => {
    let waited;
    let responded;
    handlers[type]({ ...extra, waitUntil: (p) => { waited = p; }, respondWith: (p) => { responded = p; } });
    await waited;
    return responded;
  };
  return { run, store, fetched, state: () => ({ skipped, claimed }) };
}

test('service worker: install caches the app, activate removes old versions', async () => {
  const sw = loadWorker({ 'lumora-0.0.1': [['./index.html', 'old']], 'other-app': [] });
  await sw.run('install');
  const current = sw.store.get(`lumora-${VERSION}`);
  assert.equal(current.size, appFiles.length);
  assert.equal(sw.state().skipped, false, 'a new version must wait until the page says it is safe to switch');
  await sw.run('activate');
  assert.deepEqual([...sw.store.keys()].sort(), ['other-app', `lumora-${VERSION}`].sort());
  assert.equal(sw.state().claimed, true);
});

test('service worker: only switches versions when the page asks', async () => {
  const sw = loadWorker();
  sw.run('message', { data: { type: 'SOMETHING_ELSE' } });
  assert.equal(sw.state().skipped, false);
  sw.run('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(sw.state().skipped, true);
});

test('service worker: serves from cache offline, navigations get index.html', async () => {
  const sw = loadWorker();
  await sw.run('install');
  const get = (url, mode = 'cors') => sw.run('fetch', { request: { method: 'GET', url, mode } });
  assert.equal(await get('https://app.test/styles.css'), 'body of ./styles.css');
  assert.equal(await get('https://app.test/src/app.js?v=2'), 'body of ./src/app.js');
  assert.equal(await get('https://app.test/?sample=coffee', 'navigate'), 'body of ./index.html');
  assert.equal(await get('https://app.test/not-cached.csv'), 'network ./not-cached.csv');
  // Cross-origin and non-GET requests are left alone.
  assert.equal(await sw.run('fetch', { request: { method: 'GET', url: 'https://cdn.example/x.js', mode: 'cors' } }), undefined);
  assert.equal(await sw.run('fetch', { request: { method: 'POST', url: 'https://app.test/x', mode: 'cors' } }), undefined);
});
