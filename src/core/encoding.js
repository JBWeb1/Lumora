// Turn file bytes into text, whatever the encoding.
//
// Most files are UTF-8, but Excel on Windows saves "CSV" as Windows-1252 (so é and £ would
// show as �), and "Unicode Text" as UTF-16. The byte-order mark identifies UTF-16; otherwise
// we try strict UTF-8 and fall back to Windows-1252, which can decode any byte.

export function decodeText(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Lumora's own JSON files (projects, recipes, forms, responses) are recognised from their start. */
export function isLumoraFile(text) {
  return /^\s*\{\s*"(?:format|kind)"\s*:\s*"lumora-/.test(text.slice(0, 300));
}
