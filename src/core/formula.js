// A small, safe formula language for calculated columns (no eval).
//
//   revenue / customers
//   round([price per unit] * 1.2, 2)
//   if(temperature_c > 20 and not rainy, "hot", "mild")
//   year(date) & "-" & weekday(date)
//
// Columns are referenced by bare name or in [square brackets] when the name has spaces.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY = 86400000;

export class FormulaError extends Error {}

const num = (v) => (typeof v === 'boolean' ? +v : isNum(v) ? v : null);
const str = (v) => (v == null ? null : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
const date = (v) => (isNum(v) ? new Date(v) : null);
const math = (fn) => (...args) => {
  const xs = args.map(num);
  if (xs.some((x) => x == null)) return null;
  const r = fn(...xs);
  return isNum(r) ? r : null;
};

/** Functions available in formulas, with help text shown in the UI. */
export const FUNCTIONS = {
  if: { args: 'condition, then, else', help: 'Pick a value based on a condition.', min: 3, max: 3, lazy: true },
  round: { args: 'number, digits', help: 'Round to a number of decimal places (default 0).', min: 1, max: 2, fn: (x, d = 0) => math((a, b) => { const f = 10 ** b; return Math.round(a * f) / f; })(x, d) },
  abs: { args: 'number', help: 'Distance from zero.', min: 1, max: 1, fn: math(Math.abs) },
  sqrt: { args: 'number', help: 'Square root.', min: 1, max: 1, fn: math(Math.sqrt) },
  log: { args: 'number', help: 'Natural logarithm. Handy for squashing skewed values.', min: 1, max: 1, fn: math((x) => (x > 0 ? Math.log(x) : NaN)) },
  log10: { args: 'number', help: 'Base-10 logarithm.', min: 1, max: 1, fn: math((x) => (x > 0 ? Math.log10(x) : NaN)) },
  exp: { args: 'number', help: 'e raised to a power.', min: 1, max: 1, fn: math(Math.exp) },
  floor: { args: 'number', help: 'Round down.', min: 1, max: 1, fn: math(Math.floor) },
  ceil: { args: 'number', help: 'Round up.', min: 1, max: 1, fn: math(Math.ceil) },
  pow: { args: 'base, exponent', help: 'Raise a number to a power (same as ^).', min: 2, max: 2, fn: math(Math.pow) },
  min: { args: 'a, b, …', help: 'Smallest of the values.', min: 1, max: Infinity, fn: (...a) => { const xs = a.map(num).filter((x) => x != null); return xs.length ? Math.min(...xs) : null; } },
  max: { args: 'a, b, …', help: 'Largest of the values.', min: 1, max: Infinity, fn: (...a) => { const xs = a.map(num).filter((x) => x != null); return xs.length ? Math.max(...xs) : null; } },
  year: { args: 'date', help: 'Year of a date.', min: 1, max: 1, fn: (d) => date(d)?.getUTCFullYear() ?? null },
  month: { args: 'date', help: 'Month number (1–12).', min: 1, max: 1, fn: (d) => (date(d) ? date(d).getUTCMonth() + 1 : null) },
  day: { args: 'date', help: 'Day of the month.', min: 1, max: 1, fn: (d) => date(d)?.getUTCDate() ?? null },
  weekday: { args: 'date', help: 'Day of the week, e.g. "Mon".', min: 1, max: 1, fn: (d) => (date(d) ? WEEKDAYS[date(d).getUTCDay()] : null) },
  daysBetween: { args: 'start, end', help: 'Number of days from one date to another.', min: 2, max: 2, fn: (a, b) => (isNum(a) && isNum(b) ? Math.round((b - a) / DAY) : null) },
  len: { args: 'text', help: 'Number of characters.', min: 1, max: 1, fn: (s) => str(s)?.length ?? null },
  upper: { args: 'text', help: 'UPPERCASE text.', min: 1, max: 1, fn: (s) => str(s)?.toUpperCase() ?? null },
  lower: { args: 'text', help: 'lowercase text.', min: 1, max: 1, fn: (s) => str(s)?.toLowerCase() ?? null },
  trim: { args: 'text', help: 'Remove spaces at the start and end.', min: 1, max: 1, fn: (s) => str(s)?.trim() ?? null },
  left: { args: 'text, count', help: 'First characters of the text.', min: 2, max: 2, fn: (s, n) => (str(s) == null || num(n) == null ? null : str(s).slice(0, num(n))) },
  contains: { args: 'text, search', help: 'Yes if the text contains the search (ignores case).', min: 2, max: 2, fn: (s, q) => (str(s) == null ? null : str(s).toLowerCase().includes(String(str(q) ?? '').toLowerCase())) },
  concat: { args: 'a, b, …', help: 'Join values into one text (same as &).', min: 1, max: Infinity, fn: (...a) => a.map((v) => str(v) ?? '').join('') },
  isMissing: { args: 'value', help: 'Yes if the value is missing.', min: 1, max: 1, fn: (v) => v == null },
  coalesce: { args: 'a, b, …', help: 'The first value that is not missing.', min: 1, max: Infinity, fn: (...a) => a.find((v) => v != null) ?? null },
  bucket: { args: 'number, size', help: 'Group numbers into ranges, e.g. bucket(age, 10) gives "20–30".', min: 2, max: 2, fn: (x, size) => { const a = num(x); const s = num(size); if (a == null || !s) return null; const lo = Math.floor(a / s) * s; return `${lo}–${lo + s}`; } },
};

// ---------- tokenizer ----------

const OPERATORS = ['==', '!=', '<>', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '^', '&', '=', '<', '>', '(', ')', ','];

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const start = i;
    if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new FormulaError(`Unexpected "${ch}" at position ${i + 1}.`);
      tokens.push({ t: 'num', v: Number(m[0]), pos: start });
      i += m[0].length;
    } else if (ch === '"' || ch === "'") {
      let s = '';
      i++;
      while (i < src.length && src[i] !== ch) s += src[i++];
      if (i >= src.length) throw new FormulaError('A piece of text is missing its closing quote.');
      i++;
      tokens.push({ t: 'str', v: s, pos: start });
    } else if (ch === '[') {
      const end = src.indexOf(']', i);
      if (end < 0) throw new FormulaError('A column name in [brackets] is missing its closing ].');
      tokens.push({ t: 'col', v: src.slice(i + 1, end).trim(), pos: start });
      i = end + 1;
    } else if (/[\p{L}_]/u.test(ch)) {
      const m = /^[\p{L}_][\p{L}\p{N}_.]*/u.exec(src.slice(i));
      tokens.push({ t: 'id', v: m[0], pos: start });
      i += m[0].length;
    } else {
      const op = OPERATORS.find((o) => src.startsWith(o, i));
      if (!op) throw new FormulaError(`Unexpected "${ch}" at position ${i + 1}.`);
      tokens.push({ t: 'op', v: op, pos: start });
      i += op.length;
    }
  }
  return tokens;
}

// ---------- parser (precedence climbing) ----------

const BINARY = {
  or: 1, '||': 1,
  and: 2, '&&': 2,
  '=': 4, '==': 4, '!=': 4, '<>': 4, '<': 4, '<=': 4, '>': 4, '>=': 4,
  '&': 5,
  '+': 6, '-': 6,
  '*': 7, '/': 7, '%': 7,
  '^': 9,
};

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** The most similar column name, for "did you mean" hints on typos. */
function closest(name, options) {
  const lower = name.toLowerCase();
  let best = null;
  let bestScore = Infinity;
  for (const o of options) {
    const ol = o.toLowerCase();
    const score = ol.includes(lower) || lower.includes(ol) ? 0.5 : editDistance(lower, ol);
    if (score < bestScore) {
      best = o;
      bestScore = score;
    }
  }
  return bestScore <= Math.max(name.length >= 4 ? 2 : 1, Math.floor(name.length / 3)) ? best : null;
}

/** Parse a formula against the available column names. Throws FormulaError with a friendly message. */
export function parseFormula(src, columnNames) {
  if (!String(src).trim()) throw new FormulaError('Type a formula, for example: price * quantity');
  const tokens = tokenize(src);
  let p = 0;
  const used = new Set();
  const peek = () => tokens[p];
  const opOf = (tok) => (tok?.t === 'op' ? tok.v : tok?.t === 'id' && ['and', 'or'].includes(tok.v.toLowerCase()) ? tok.v.toLowerCase() : null);
  const expect = (v) => {
    if (peek()?.v !== v) throw new FormulaError(peek() ? `Expected "${v}" but found "${peek().v}".` : `The formula ends too early: expected "${v}".`);
    p++;
  };

  const column = (name) => {
    const exact = columnNames.find((c) => c === name) ?? columnNames.find((c) => c.toLowerCase() === name.toLowerCase());
    if (exact == null) {
      const hint = closest(name, columnNames);
      throw new FormulaError(`There is no column called "${name}".${hint ? ` Did you mean "${hint}"?` : ''}${/\s/.test(name) ? '' : ' Use [square brackets] for names with spaces.'}`);
    }
    used.add(exact);
    return { k: 'col', name: exact };
  };

  function primary() {
    const tok = peek();
    if (!tok) throw new FormulaError('The formula ends too early.');
    p++;
    if (tok.t === 'num') return { k: 'lit', v: tok.v };
    if (tok.t === 'str') return { k: 'lit', v: tok.v };
    if (tok.t === 'col') return column(tok.v);
    if (tok.t === 'op' && tok.v === '(') {
      const e = expression(0);
      expect(')');
      return e;
    }
    if (tok.t === 'op' && tok.v === '-') return { k: 'neg', a: expression(8) };
    if (tok.t === 'op' && tok.v === '+') return expression(8);
    if (tok.t === 'id') {
      const lower = tok.v.toLowerCase();
      if (lower === 'not') return { k: 'not', a: expression(3) };
      if (peek()?.v === '(' && !columnNames.includes(tok.v)) {
        const name = Object.keys(FUNCTIONS).find((f) => f.toLowerCase() === lower);
        if (!name) throw new FormulaError(`Unknown function "${tok.v}". See the list of functions below the formula box.`);
        p++;
        const args = [];
        if (peek()?.v !== ')') {
          args.push(expression(0));
          while (peek()?.v === ',') {
            p++;
            args.push(expression(0));
          }
        }
        expect(')');
        const f = FUNCTIONS[name];
        if (args.length < f.min || args.length > f.max) throw new FormulaError(`${name}() needs ${f.args}.`);
        return { k: 'call', name, args };
      }
      if (lower === 'true' || lower === 'yes') return { k: 'lit', v: true };
      if (lower === 'false' || lower === 'no') return { k: 'lit', v: false };
      return column(tok.v);
    }
    throw new FormulaError(`Unexpected "${tok.v}".`);
  }

  function expression(minPrec) {
    let left = primary();
    for (;;) {
      const op = opOf(peek());
      const prec = op ? BINARY[op] : 0;
      if (!prec || prec < minPrec) break;
      p++;
      // Left-associative except ^ (2^3^2 = 2^9).
      const right = expression(op === '^' ? prec : prec + 1);
      left = { k: 'bin', op, a: left, b: right };
    }
    return left;
  }

  const ast = expression(0);
  if (p < tokens.length) throw new FormulaError(`Unexpected "${peek().v}". Is an operator or comma missing?`);
  return { ast, columns: [...used] };
}

// ---------- evaluation ----------

function equal(a, b) {
  if (typeof a === 'string' || typeof b === 'string') return String(str(a)).toLowerCase() === String(str(b)).toLowerCase();
  return num(a) === num(b);
}

function evaluate(node, row) {
  switch (node.k) {
    case 'lit': return node.v;
    case 'col': return row(node.name);
    case 'neg': { const a = num(evaluate(node.a, row)); return a == null ? null : -a; }
    case 'not': { const a = evaluate(node.a, row); return a == null ? null : !a; }
    case 'call': {
      if (node.name === 'if') {
        const c = evaluate(node.args[0], row);
        return evaluate(c ? node.args[1] : node.args[2], row);
      }
      return FUNCTIONS[node.name].fn(...node.args.map((a) => evaluate(a, row)));
    }
    case 'bin': {
      const { op } = node;
      if (op === 'and' || op === '&&') return Boolean(evaluate(node.a, row)) && Boolean(evaluate(node.b, row));
      if (op === 'or' || op === '||') return Boolean(evaluate(node.a, row)) || Boolean(evaluate(node.b, row));
      const a = evaluate(node.a, row);
      const b = evaluate(node.b, row);
      if (op === '&') return (str(a) ?? '') + (str(b) ?? '');
      if (a == null || b == null) return null;
      if (op === '=' || op === '==') return equal(a, b);
      if (op === '!=' || op === '<>') return !equal(a, b);
      if (op === '+' && (typeof a === 'string' || typeof b === 'string')) return str(a) + str(b);
      if (['<', '<=', '>', '>='].includes(op) && typeof a === 'string' && typeof b === 'string') {
        const c = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        return { '<': c < 0, '<=': c <= 0, '>': c > 0, '>=': c >= 0 }[op];
      }
      const x = num(a);
      const y = num(b);
      if (x == null || y == null) return null;
      let r;
      switch (op) {
        case '+': r = x + y; break;
        case '-': r = x - y; break;
        case '*': r = x * y; break;
        case '/': r = y === 0 ? null : x / y; break;
        case '%': r = y === 0 ? null : x % y; break;
        case '^': r = x ** y; break;
        case '<': return x < y;
        case '<=': return x <= y;
        case '>': return x > y;
        case '>=': return x >= y;
        default: throw new FormulaError(`Unknown operator ${op}`);
      }
      return isNum(r) ? r : null;
    }
    default: throw new FormulaError('Invalid formula.');
  }
}

/**
 * Evaluate a formula for every row of a dataset.
 * Returns the list of results (numbers, strings, booleans or null).
 */
export function evaluateFormula(src, dataset, rows) {
  const names = dataset.columns.map((c) => c.name);
  const { ast } = parseFormula(src, names);
  const byName = new Map(dataset.columns.map((c) => [c.name, c.values]));
  const list = rows ?? [...Array(dataset.rowCount).keys()];
  return list.map((i) => evaluate(ast, (name) => byName.get(name)[i] ?? null));
}
