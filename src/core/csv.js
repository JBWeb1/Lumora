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

/** Parse delimited text into an array of rows (arrays of strings). Blank lines are dropped. */
export function parseCSV(text, delimiter) {
  text = stripBom(text);
  delimiter = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const n = text.length;

  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
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
