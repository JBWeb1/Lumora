// Fast hand-off of a dataset between the background worker and the page.
//
// Copying millions of individual values between threads is slow, so columns travel as:
//   raw text   → one long string joined with \0, split again on arrival (native, fast)
//   numbers and dates → a Float64Array (NaN = missing), transferred without copying
//   yes/no     → an Int8Array (1, 0, -1 = missing)
//   categories / text → rebuilt from the raw text on arrival

import { convertValues } from './infer.js';

const SEP = '\u0000';

export function packDataset(ds) {
  const transfer = [];
  const columns = ds.columns.map((c) => {
    const out = { name: c.name, type: c.type, inferredType: c.inferredType };
    const joinable = !c.raw.some((r) => r.includes(SEP));
    if (joinable) out.rawJoined = c.raw.join(SEP);
    else out.raw = c.raw;
    if (c.type === 'number' || c.type === 'date') {
      const arr = new Float64Array(c.values.length);
      for (let i = 0; i < arr.length; i++) arr[i] = c.values[i] ?? NaN;
      out.numbers = arr;
      transfer.push(arr.buffer);
    } else if (c.type === 'boolean') {
      const arr = new Int8Array(c.values.length);
      for (let i = 0; i < arr.length; i++) arr[i] = c.values[i] == null ? -1 : c.values[i] ? 1 : 0;
      out.flags = arr;
      transfer.push(arr.buffer);
    }
    return out;
  });
  return { packed: { name: ds.name, rowCount: ds.rowCount, columns }, transfer };
}

export function unpackDataset(packed) {
  const columns = packed.columns.map((c) => {
    const raw = c.rawJoined != null ? (packed.rowCount ? c.rawJoined.split(SEP) : []) : c.raw;
    let values;
    if (c.numbers) {
      values = new Array(c.numbers.length);
      for (let i = 0; i < values.length; i++) values[i] = Number.isNaN(c.numbers[i]) ? null : c.numbers[i];
    } else if (c.flags) {
      values = new Array(c.flags.length);
      for (let i = 0; i < values.length; i++) values[i] = c.flags[i] < 0 ? null : c.flags[i] === 1;
    } else {
      values = convertValues(raw, c.type);
    }
    return { name: c.name, type: c.type, inferredType: c.inferredType, raw, values };
  });
  return { name: packed.name, rowCount: packed.rowCount, columns };
}

// Yield to the browser between slices so the page keeps painting while a big file arrives.
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));
const SLICE = 100_000;

/** Split a \0-joined string in slices (a single native split of millions of values freezes the page). */
async function splitInSlices(joined, count) {
  const out = new Array(count);
  let start = 0;
  for (let i = 0; i < count; i++) {
    const end = i === count - 1 ? joined.length : joined.indexOf(SEP, start);
    out[i] = joined.slice(start, end);
    start = end + 1;
    if (i % SLICE === SLICE - 1) await nextTick();
  }
  return out;
}

async function mapInSlices(length, fn) {
  const out = new Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = fn(i);
    if (i % SLICE === SLICE - 1) await nextTick();
  }
  return out;
}

/** Same result as unpackDataset, but never blocks the page for long. `onProgress(0..1)`. */
export async function unpackDatasetAsync(packed, onProgress = () => {}) {
  const columns = [];
  const n = packed.rowCount;
  for (const [k, c] of packed.columns.entries()) {
    const raw = c.rawJoined != null ? (n ? await splitInSlices(c.rawJoined, n) : []) : c.raw;
    let values;
    if (c.numbers) values = await mapInSlices(n, (i) => (Number.isNaN(c.numbers[i]) ? null : c.numbers[i]));
    else if (c.flags) values = await mapInSlices(n, (i) => (c.flags[i] < 0 ? null : c.flags[i] === 1));
    else {
      values = new Array(n);
      for (let i = 0; i < n; i += SLICE) {
        const part = convertValues(raw.slice(i, i + SLICE), c.type);
        for (let k = 0; k < part.length; k++) values[i + k] = part[k];
        await nextTick();
      }
    }
    columns.push({ name: c.name, type: c.type, inferredType: c.inferredType, raw, values });
    onProgress((k + 1) / packed.columns.length);
  }
  return { name: packed.name, rowCount: packed.rowCount, columns };
}
