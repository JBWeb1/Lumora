// Minimal Excel (.xlsx) writer — no libraries.
//
// writeXlsx({ sheets: [{ name, headers, types, rows, chart? }] }) → Promise<Uint8Array>
//   types: 'number' | 'date' | 'boolean' | 'text' per column (dates as UTC ms)
//   chart: { type: 'bar' | 'line' | 'scatter', title, categoryColumn: 0, valueColumns: [1, …], xTitle, yTitle }
//          → a native, editable Excel chart that reads its data from the sheet.
//
// Cells keep their real types (numbers are numbers, dates are dates), the header row is
// bold with filters, frozen, and column widths fit the content.

const enc = new TextEncoder();
export const EXCEL_MAX_ROWS = 1048575; // + 1 header row

// ---------- zip ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Build a zip archive from { path: string | Uint8Array }. */
export async function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = typeof content === 'string' ? enc.encode(content) : content;
    const deflated = raw.length > 64 ? await deflateRaw(raw) : null;
    const method = deflated && deflated.length < raw.length ? 8 : 0;
    const data = method ? deflated : raw;
    const crc = crc32(raw);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, method, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, raw.length, true);
    c.setUint16(28, nameBytes.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length / 2, true);
  end.setUint16(10, central.length / 2, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------- spreadsheet XML ----------

// XML can't contain most control characters; drop them rather than produce a broken file.
const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function columnLetter(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const toSerial = (ms) => ms / 86400000 + 25569;

// Style ids (see styles.xml below): 0 normal, 1 bold header, 2 date, 3 date+time
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDEF3F8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(ref, v, type) {
  if (v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return '';
  if (type === 'date' && typeof v === 'number') return `<c r="${ref}" s="${v % 86400000 === 0 ? 2 : 3}"><v>${toSerial(v)}</v></c>`;
  if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml(sheet, hasChart) {
  const { headers, rows, types } = sheet;
  const last = columnLetter(headers.length - 1);
  // Column widths from the header and the first rows.
  const widths = headers.map((h, j) => {
    let w = String(h).length;
    for (const r of rows.slice(0, 200)) {
      const v = r[j];
      const len = types[j] === 'date' ? 16 : typeof v === 'number' ? String(Math.round(v * 100) / 100).length : String(v ?? '').length;
      if (len > w) w = len;
    }
    return Math.min(60, Math.max(8, w + 2));
  });
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
  out.push(`<dimension ref="A1:${last}${rows.length + 1}"/>`);
  out.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
  out.push(`<cols>${widths.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`);
  out.push('<sheetData>');
  out.push(`<row r="1">${headers.map((h, j) => `<c r="${columnLetter(j)}1" s="1" t="inlineStr"><is><t>${esc(h)}</t></is></c>`).join('')}</row>`);
  const letters = headers.map((_, j) => columnLetter(j));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const n = i + 2;
    let cells = '';
    for (let j = 0; j < letters.length; j++) cells += cellXml(`${letters[j]}${n}`, r[j], types[j]);
    out.push(`<row r="${n}">${cells}</row>`);
  }
  out.push('</sheetData>');
  if (rows.length) out.push(`<autoFilter ref="A1:${last}${rows.length + 1}"/>`);
  if (hasChart) out.push('<drawing r:id="rId1"/>');
  out.push('</worksheet>');
  return out.join('');
}

// ---------- charts ----------

const COLORS = ['0E7490', 'E8833A', '1F9D6B', 'D6457A', '5B5BD6', 'B8941C', '9B59D0', '8A8A9C'];
const sheetRef = (name) => `'${name.replace(/'/g, "''")}'`;
// Formula references go inside XML, so they are escaped (sheet names may contain & or <).
const range = (sheet, col, r1, r2) => esc(`${sheetRef(sheet)}!$${columnLetter(col)}$${r1}:$${columnLetter(col)}$${r2}`);
const cellRef = (sheet, col, r) => esc(`${sheetRef(sheet)}!$${columnLetter(col)}$${r}`);

function richTitle(text, size = 1200) {
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="${size}" b="1"/><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}

function numCache(values, format = 'General') {
  return `<c:numCache><c:formatCode>${format}</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => (Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '')).join('')}</c:numCache>`;
}
function strCache(values) {
  return `<c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v ?? '')}</c:v></c:pt>`).join('')}</c:strCache>`;
}

function axis(kind, id, crossId, pos, title, { gridlines = false, format = 'General', sourceLinked = 1 } = {}) {
  const head = `<c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${gridlines ? '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E6EDF4"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' : ''}${title ? richTitle(title, 1000) : ''}<c:numFmt formatCode="${format}" sourceLinked="${sourceLinked}"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${crossId}"/><c:crosses val="autoZero"/>`;
  if (kind === 'cat') return `<c:catAx>${head}<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  if (kind === 'date') return `<c:dateAx>${head}<c:auto val="1"/><c:lblOffset val="100"/><c:baseTimeUnit val="days"/></c:dateAx>`;
  return `<c:valAx>${head}<c:crossBetween val="${pos === 'b' ? 'midCat' : 'between'}"/></c:valAx>`;
}

function chartXml(sheet) {
  const { chart, rows, headers, types, name } = sheet;
  // `rowLimit` lets a chart skip trailing rows such as a Total row.
  const n = Math.min(rows.length, chart.rowLimit ?? rows.length);
  const first = 2;
  const lastRow = n + 1;
  const cat = chart.categoryColumn ?? 0;
  const catValues = rows.slice(0, n).map((r) => r[cat]);
  const catIsDate = types[cat] === 'date';
  const catIsNum = types[cat] === 'number' || catIsDate;
  const catRef = catIsNum
    ? `<c:numRef><c:f>${range(name, cat, first, lastRow)}</c:f>${numCache(catValues.map((v) => (catIsDate && v != null ? toSerial(v) : v)), catIsDate ? 'yyyy-mm-dd' : 'General')}</c:numRef>`
    : `<c:strRef><c:f>${range(name, cat, first, lastRow)}</c:f>${strCache(catValues.map((v) => (v == null ? '' : String(v))))}</c:strRef>`;
  const series = chart.valueColumns.map((col, k) => {
    // Optional per-series look: { color: 'RRGGBB', dash: true }
    const style = chart.seriesStyles?.[k] ?? {};
    const color = style.color ?? COLORS[k % COLORS.length];
    const tx = `<c:tx><c:strRef><c:f>${cellRef(name, col, 1)}</c:f>${strCache([headers[col]])}</c:strRef></c:tx>`;
    const val = `<c:numRef><c:f>${range(name, col, first, lastRow)}</c:f>${numCache(rows.slice(0, n).map((r) => r[col]))}</c:numRef>`;
    if (chart.type === 'scatter') {
      return `<c:ser><c:idx val="${k}"/><c:order val="${k}"/>${tx}<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr><a:solidFill><a:srgbClr val="${color}"><a:alpha val="70000"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:marker><c:xVal>${catRef}</c:xVal><c:yVal>${val}</c:yVal><c:smooth val="0"/></c:ser>`;
    }
    if (chart.type === 'line') {
      return `<c:ser><c:idx val="${k}"/><c:order val="${k}"/>${tx}<c:spPr><a:ln w="${style.dash ? 19050 : 22225}" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${style.dash ? '<a:prstDash val="dash"/>' : ''}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker><c:cat>${catRef}</c:cat><c:val>${val}</c:val><c:smooth val="0"/></c:ser>`;
    }
    return `<c:ser><c:idx val="${k}"/><c:order val="${k}"/>${tx}<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/><c:cat>${catRef}</c:cat><c:val>${val}</c:val></c:ser>`;
  }).join('');
  let plot;
  if (chart.type === 'scatter') {
    plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${series}<c:axId val="5001"/><c:axId val="5002"/></c:scatterChart>${axis('val', 5001, 5002, 'b', chart.xTitle, { format: catIsDate ? 'yyyy-mm-dd' : 'General' })}${axis('val', 5002, 5001, 'l', chart.yTitle, { gridlines: true })}`;
  } else if (chart.type === 'line') {
    plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="5001"/><c:axId val="5002"/></c:lineChart>${axis(catIsDate ? 'date' : 'cat', 5001, 5002, 'b', chart.xTitle, { format: catIsDate ? 'mmm yyyy' : 'General', sourceLinked: catIsDate ? 0 : 1 })}${axis('val', 5002, 5001, 'l', chart.yTitle, { gridlines: true })}`;
  } else {
    plot = `<c:barChart><c:barDir val="${chart.horizontal ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="60"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>${axis('cat', 5001, 5002, chart.horizontal ? 'l' : 'b', chart.xTitle)}${axis('val', 5002, 5001, chart.horizontal ? 'b' : 'l', chart.yTitle, { gridlines: true })}`;
  }
  const legend = chart.valueColumns.length > 1 ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart>${chart.title ? richTitle(chart.title) : ''}<c:autoTitleDeleted val="${chart.title ? 0 : 1}"/><c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

function drawingXml(col) {
  const anchor = (c, r) => `<xdr:col>${c}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r}</xdr:row><xdr:rowOff>0</xdr:rowOff>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from>${anchor(col, 1)}</xdr:from><xdr:to>${anchor(col + 10, 23)}</xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
}

/** Excel sheet names: max 31 chars, no []:*?/\ and unique. */
export function sheetName(name, used) {
  let base = String(name || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let out = base;
  for (let k = 2; used.has(out.toLowerCase()); k++) out = `${base.slice(0, 28)} ${k}`;
  used.add(out.toLowerCase());
  return out;
}

export async function writeXlsx({ sheets }) {
  const used = new Set();
  const named = sheets.map((s) => ({ ...s, name: sheetName(s.name, used), rows: s.rows.slice(0, EXCEL_MAX_ROWS) }));
  const files = {};
  const overrides = [];
  let chartNo = 0;
  named.forEach((s, i) => {
    const hasChart = !!s.chart && s.rows.length > 0;
    files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s, hasChart);
    overrides.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    if (hasChart) {
      chartNo++;
      files[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${chartNo}.xml"/></Relationships>`;
      files[`xl/drawings/drawing${chartNo}.xml`] = drawingXml(s.headers.length + 1);
      files[`xl/drawings/_rels/drawing${chartNo}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNo}.xml"/></Relationships>`;
      files[`xl/charts/chart${chartNo}.xml`] = chartXml(s);
      overrides.push(`<Override PartName="/xl/drawings/drawing${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      overrides.push(`<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
    }
  });
  files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides.join('')}</Types>`;
  files['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  files['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${named.some((s) => s.rows.length) ? `<definedNames>${named.map((s, i) => (s.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(`${sheetRef(s.name)}!$A$1:$${columnLetter(s.headers.length - 1)}$${s.rows.length + 1}`)}</definedName>` : '')).join('')}</definedNames>` : ''}</workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  files['xl/styles.xml'] = STYLES;
  return zip(files);
}

/** Sheet input from dataset rows: typed values straight from the columns. */
export function datasetSheet(dataset, indices, name = dataset.name) {
  const types = dataset.columns.map((c) => (c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : c.type === 'boolean' ? 'boolean' : 'text'));
  const rows = indices.map((i) => dataset.columns.map((c) => (c.type === 'boolean' ? c.values[i] : c.type === 'number' || c.type === 'date' ? c.values[i] ?? c.raw[i] : c.raw[i])));
  return { name, headers: dataset.columns.map((c) => c.name), types, rows };
}
