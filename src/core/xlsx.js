// Minimal Excel (.xlsx) reader using only built-in browser APIs (DecompressionStream).
// Reads cell values from every sheet, including shared strings, booleans and dates.

const decoder = new TextDecoder();

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read the file list of a zip archive. */
export function unzip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This is not a valid .xlsx file.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map();
  for (let k = 0; k < count; k++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('The .xlsx file is damaged.');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    files.set(decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen)), { method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    has: (name) => files.has(name),
    async text(name) {
      const f = files.get(name);
      if (!f) return null;
      const start = f.offset + 30 + view.getUint16(f.offset + 26, true) + view.getUint16(f.offset + 28, true);
      const data = bytes.subarray(start, start + f.size);
      if (f.method === 0) return decoder.decode(data);
      if (f.method === 8) return decoder.decode(await inflateRaw(data));
      throw new Error('This .xlsx file uses an unsupported compression method.');
    },
  };
}

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeXml(m[2]);
  return out;
}

/** Concatenate the <t> text runs inside an element (ignoring phonetic hints). */
function textOf(xml) {
  let s = '';
  for (const m of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += m[1];
  return decodeXml(s);
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function isDateFormat(id, code) {
  if (BUILTIN_DATE_FORMATS.has(id)) return true;
  if (!code) return false;
  const cleaned = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
  return /[dy]/i.test(cleaned) || /h+.*m+|m+.*s+/i.test(cleaned);
}

function dateStyles(stylesXml) {
  if (!stylesXml) return [];
  const custom = new Map();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    const a = attrs(m[0]);
    custom.set(Number(a.numFmtId), a.formatCode);
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!xfs) return [];
  return [...xfs[1].matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attrs(m[0]).numFmtId ?? 0);
    return isDateFormat(id, custom.get(id));
  });
}

const pad = (n) => String(n).padStart(2, '0');

/** Excel stores dates as days since 1899-12-30. */
export function excelSerialToISO(serial) {
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return String(serial);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return ms % 86400000 === 0 ? date : `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function columnIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml, shared, dates) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
    let next = 0;
    for (const cell of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(cell[1]);
      const col = a.r ? columnIndex(a.r) : next;
      next = col + 1;
      const inner = cell[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (a.t === 's') value = shared[Number(v)] ?? '';
      else if (a.t === 'inlineStr') value = textOf(inner);
      else if (a.t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (a.t === 'e') value = '';
      else if (v != null) {
        const text = decodeXml(v);
        value = a.t !== 'str' && dates[Number(a.s ?? 0)] && Number.isFinite(Number(text)) ? excelSerialToISO(Number(text)) : text;
      }
      while (row.length < col) row.push('');
      row[col] = value;
    }
    if (row.some((v) => v !== '')) rows.push(row);
  }
  return rows;
}

/**
 * Read every sheet of an .xlsx workbook.
 * Returns [{ name, headers, rows }] for sheets that contain data.
 */
export async function readXlsx(buffer) {
  const zip = unzip(buffer);
  const workbook = await zip.text('xl/workbook.xml');
  if (!workbook) throw new Error('This file does not look like an Excel workbook.');
  const rels = (await zip.text('xl/_rels/workbook.xml.rels')) ?? '';
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const a = attrs(m[0]);
    return [a.Id, a.Target];
  }));
  const sharedXml = (await zip.text('xl/sharedStrings.xml')) ?? '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const dates = dateStyles(await zip.text('xl/styles.xml'));

  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    let target = targets.get(a['r:id']);
    if (!target) continue;
    target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = await zip.text(target);
    if (!xml) continue;
    const grid = parseSheet(xml, shared, dates);
    if (!grid.length) continue;
    const width = Math.max(...grid.map((r) => r.length));
    const [headers, ...rows] = grid.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
    sheets.push({ name: a.name, headers, rows });
  }
  if (!sheets.length) throw new Error('The workbook has no data.');
  return sheets;
}
