import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from '../src/core/csv.js';

// The original, simple character-by-character parser, kept as the reference for correctness.
function referenceParse(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      row.push(field); rows.push(row); row = []; field = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function rng(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

test('fast parser matches the reference parser on 2,000 random tricky inputs', () => {
  const rand = rng(99);
  const pieces = ['a', 'bc', '1.5', ' ', ',', ';', '"', '""', '\n', '\r\n', '\r', 'é', 'x y', '', '"q,uoted"', '"multi\nline"'];
  for (let t = 0; t < 2000; t++) {
    let text = '';
    const len = Math.floor(rand() * 30);
    for (let k = 0; k < len; k++) text += pieces[Math.floor(rand() * pieces.length)];
    for (const d of [',', ';']) {
      assert.deepEqual(parseCSV(text, d), referenceParse(text, d), `input ${JSON.stringify(text)} delimiter ${d}`);
    }
  }
});

test('progress is reported for large inputs and parsing is fast', () => {
  const line = '2024-01-01,Some product name,"quoted, with comma",123.45,yes\n';
  const text = 'date,product,note,price,flag\n' + line.repeat(200000); // ~12 MB
  const seen = [];
  const t0 = performance.now();
  const rows = parseCSV(text, ',', (f) => seen.push(f));
  const ms = performance.now() - t0;
  assert.equal(rows.length, 200001);
  assert.deepEqual(rows[1], ['2024-01-01', 'Some product name', 'quoted, with comma', '123.45', 'yes']);
  assert.ok(seen.length >= 10 && seen.every((f, k) => f > 0 && f <= 1 && (k === 0 || f > seen[k - 1])));
  assert.ok(ms < 3000, `parsing 12 MB took ${Math.round(ms)} ms`);
});
