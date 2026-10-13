// CSV / TSV parsing with automatic delimiter detection (RFC 4180 quoting rules).

const DELIMITERS = [',', '\t', ';', '|'];

function countOutsideQuotes(line, delimiter) {
  let count = 0;
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delimiter && !inQuotes) count++;
  }
  return count;
}

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Guess the delimiter by finding the one used most consistently across the first lines. */
export function detectDelimiter(text) {
  const lines = [];
  for (const line of stripBom(text).slice(0, 50000).split(/\r\n|\n|\r/)) {
    if (line.trim()) lines.push(line);
    if (lines.length >= 20) break;
  }
  let best = ',';
  let bestScore = 0;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    if (!counts.length || counts[0] === 0) continue;
    const agreement = counts.filter((c) => c === counts[0]).length / counts.length;
    const score = agreement * 100 + Math.min(counts[0], 50);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * Parse delimited text into an array of rows (arrays of strings). Blank lines are dropped.
 * Fields are sliced out whole instead of built character by character, which keeps
 * multi-hundred-megabyte files fast. `onProgress(fraction)` is called about once per MB.
 */
export function parseCSV(text, delimiter, onProgress) {
  text = stripBom(text);
  delimiter = delimiter || detectDelimiter(text);
  const D = delimiter.charCodeAt(0);
  const QUOTE = 34;
  const LF = 10;
  const CR = 13;
  const n = text.length;
  const rows = [];
  let row = [];
  let i = 0;
  let nextReport = 1 << 20;
  const fieldEnd = (k) => {
    while (k < n) {
      const c = text.charCodeAt(k);
      if (c === D || c === LF || c === CR) break;
      k++;
    }
    return k;
  };

  while (i < n) {
    let field;
    if (text.charCodeAt(i) === QUOTE) {
      // Quoted field: may contain delimiters, newlines and doubled "" quotes.
      i++;
      let start = i;
      field = '';
      for (;;) {
        const j = text.indexOf('"', i);
        if (j < 0) {
          field += text.slice(start);
          i = n;
          break;
        }
        if (text.charCodeAt(j + 1) === QUOTE) {
          field += text.slice(start, j + 1);
          i = j + 2;
          start = i;
          continue;
        }
        field += text.slice(start, j);
        i = j + 1;
        break;
      }
      // Anything between the closing quote and the next delimiter is kept, like before.
      const k = fieldEnd(i);
      if (k > i) field += text.slice(i, k);
      i = k;
    } else {
      const k = fieldEnd(i);
      field = text.slice(i, k);
      i = k;
    }
    row.push(field);
    if (i >= n) break;
    const c = text.charCodeAt(i);
    i++;
    if (c === D) {
      if (i >= n) row.push('');
      continue;
    }
    if (c === CR && text.charCodeAt(i) === LF) i++;
    rows.push(row);
    row = [];
    if (onProgress && i >= nextReport) {
      onProgress(i / n);
      nextReport = i + (1 << 20);
    }
  }
  if (row.length) rows.push(row);
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/** Turn an array of JSON objects into a header row plus string rows. */
export function rowsFromJSON(data) {
  if (!Array.isArray(data)) {
    // Accept { "rows": [...] } or { "data": [...] } wrappers.
    const inner = data && Object.values(data).find(Array.isArray);
    if (!inner) throw new Error('JSON must be an array of objects (one object per row).');
    data = inner;
  }
  const headers = [];
  const seen = new Set();
  for (const item of data) {
    if (item && typeof item === 'object') {
      for (const key of Object.keys(item)) {
        if (!seen.has(key)) {
          seen.add(key);
          headers.push(key);
        }
      }
    }
  }
  const rows = data.map((item) =>
    headers.map((h) => {
      const v = item?.[h];
      if (v == null) return '';
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    })
  );
  return { headers, rows };
}
