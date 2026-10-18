// Spreadsheet engine: tokenizer, parser, evaluator, workbook model and value formatting.
// Works in the browser (window.XL) and in Node (module.exports) so it can be unit tested.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- errors
  class XLError {
    constructor(code) { this.code = code; }
    toString() { return this.code; }
  }
  const E = {
    DIV0: '#DIV/0!', VALUE: '#VALUE!', REF: '#REF!', NAME: '#NAME?',
    NA: '#N/A', NUM: '#NUM!', NULL: '#NULL!',
  };
  const ERROR_CODES = Object.values(E);
  const err = (code) => new XLError(code);
  const isErr = (v) => v instanceof XLError;

  class SyntaxErr extends Error {}

  // A rectangular block of evaluated values, produced by range references.
  class RangeVal {
    constructor(rows, r1 = 0, c1 = 0) { this.rows = rows; this.r1 = r1; this.c1 = c1; }
    get height() { return this.rows.length; }
    get width() { return this.rows.length ? this.rows[0].length : 0; }
    *values() { for (const row of this.rows) for (const v of row) yield v; }
    column(i) { return this.rows.map((row) => row[i]); }
  }

  // ---------------------------------------------------------------- addresses
  function colName(c) {
    let s = '';
    c += 1;
    while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
    return s;
  }
  function colIndex(name) {
    let c = 0;
    for (const ch of name.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
    return c - 1;
  }
  const addr = (r, c) => colName(c) + (r + 1);
  function parseAddr(s) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(s.trim());
    if (!m) return null;
    return { r: parseInt(m[2], 10) - 1, c: colIndex(m[1]) };
  }
  function parseRangeAddr(s) {
    const parts = s.trim().split(':');
    const a = parseAddr(parts[0]);
    if (!a) return null;
    const b = parts[1] ? parseAddr(parts[1]) : a;
    if (!b) return null;
    return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
  }

  // ---------------------------------------------------------------- tokenizer
  const REF_RE = /^((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+)(?![A-Za-z0-9_(.!])/;

  function parsePart(s) {
    const m = /^(\$?)([A-Za-z]{1,3})?(\$?)(\d+)?$/.exec(s);
    const p = {};
    if (m[2] !== undefined) { p.c = colIndex(m[2]); p.ac = m[1] === '$'; }
    if (m[4] !== undefined) { p.r = parseInt(m[4], 10) - 1; p.ar = (m[2] !== undefined ? m[3] : m[1]) === '$'; }
    return p;
  }
  function partText(p) {
    let s = '';
    if (p.c !== undefined) s += (p.ac ? '$' : '') + colName(p.c);
    if (p.r !== undefined) s += (p.ar ? '$' : '') + (p.r + 1);
    return s;
  }

  function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      const rest = src.slice(i);
      let m;
      if (ch === '"') {
        let j = i + 1, s = '';
        for (;;) {
          if (j >= src.length) throw new SyntaxErr('Unterminated string');
          if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
          s += src[j++];
        }
        toks.push({ t: 'str', v: s, s: i, e: j + 1 });
        i = j + 1;
        continue;
      }
      if (ch === '#') {
        m = /^#(DIV\/0!|VALUE!|REF!|NAME\?|N\/A|NUM!|NULL!)/i.exec(rest);
        if (!m) throw new SyntaxErr('Bad error literal');
        toks.push({ t: 'err', v: m[0].toUpperCase(), s: i, e: i + m[0].length });
        i += m[0].length;
        continue;
      }
      if ((m = REF_RE.exec(rest))) {
        let sheet = null;
        if (m[1]) {
          sheet = m[1].slice(0, -1);
          if (sheet.startsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'");
        }
        const [p1, p2] = m[2].split(':');
        const a = parsePart(p1);
        const b = p2 !== undefined ? parsePart(p2) : null;
        toks.push({ t: 'ref', sheet, a, b, s: i, e: i + m[0].length });
        i += m[0].length;
        continue;
      }
      if ((m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest))) {
        toks.push({ t: 'num', v: parseFloat(m[0]), s: i, e: i + m[0].length });
        i += m[0].length;
        continue;
      }
      if ((m = /^[A-Za-z_\\][A-Za-z0-9_.]*/.exec(rest))) {
        const word = m[0];
        let j = i + word.length;
        while (j < src.length && /\s/.test(src[j])) j++;
        if (src[j] === '(') toks.push({ t: 'fn', v: word.toUpperCase().replace(/^_XLFN\./, ''), s: i, e: i + word.length });
        else if (/^(TRUE|FALSE)$/i.test(word)) toks.push({ t: 'bool', v: word.toUpperCase() === 'TRUE', s: i, e: i + word.length });
        else toks.push({ t: 'name', v: word, s: i, e: i + word.length });
        i += word.length;
        continue;
      }
      if ((m = /^(<>|<=|>=)/.exec(rest))) {
        toks.push({ t: 'op', v: m[0], s: i, e: i + 2 });
        i += 2;
        continue;
      }
      if ('+-*/^&=<>%'.includes(ch)) { toks.push({ t: 'op', v: ch, s: i, e: i + 1 }); i++; continue; }
      if ('(),;'.includes(ch)) { toks.push({ t: ch === ';' ? ',' : ch, s: i, e: i + 1 }); i++; continue; }
      throw new SyntaxErr(`Unexpected character "${ch}"`);
    }
    return toks;
  }

  // ---------------------------------------------------------------- parser
  // Precedence (low → high): comparison, &, + -, * /, ^, %, unary minus.
  function parse(src) {
    const toks = tokenize(src);
    let pos = 0;
    const peek = () => toks[pos];
    const isOp = (...ops) => peek() && peek().t === 'op' && ops.includes(peek().v);
    const expect = (t) => {
      if (!peek() || peek().t !== t) throw new SyntaxErr(`Expected ${t}`);
      return toks[pos++];
    };

    function binary(next, ops) {
      return function () {
        let l = next();
        while (isOp(...ops)) { const op = toks[pos++].v; l = { k: 'bin', op, l, r: next() }; }
        return l;
      };
    }
    function unary() {
      if (isOp('-', '+')) { const op = toks[pos++].v; return { k: 'un', op, x: unary() }; }
      return postfix();
    }
    function postfix() {
      let x = primary();
      while (isOp('%')) { pos++; x = { k: 'pct', x }; }
      return x;
    }
    const power = binary(unary, ['^']);
    const mult = binary(power, ['*', '/']);
    const add = binary(mult, ['+', '-']);
    const concat = binary(add, ['&']);
    const compare = binary(concat, ['=', '<>', '<', '>', '<=', '>=']);

    function primary() {
      const t = peek();
      if (!t) throw new SyntaxErr('Unexpected end of formula');
      pos++;
      switch (t.t) {
        case 'num': return { k: 'num', v: t.v };
        case 'str': return { k: 'str', v: t.v };
        case 'bool': return { k: 'bool', v: t.v };
        case 'err': return { k: 'err', v: t.v };
        case 'name': return { k: 'name', v: t.v };
        case 'ref': return refNode(t);
        case '(': { const x = compare(); expect(')'); return x; }
        case 'fn': {
          expect('(');
          const args = [];
          if (peek() && peek().t === ')') { pos++; return { k: 'fn', name: t.v, args }; }
          for (;;) {
            if (peek() && (peek().t === ',' || peek().t === ')')) args.push({ k: 'missing' });
            else args.push(compare());
            if (peek() && peek().t === ',') { pos++; continue; }
            expect(')');
            break;
          }
          return { k: 'fn', name: t.v, args };
        }
        default: throw new SyntaxErr('Unexpected token');
      }
    }
    const ast = compare();
    if (pos < toks.length) throw new SyntaxErr('Unexpected token after end of formula');
    return ast;
  }

  function refNode(t) {
    const { a, b, sheet } = t;
    if (!b) return { k: 'ref', sheet, r: a.r, c: a.c };
    return {
      k: 'range', sheet,
      r1: a.r ?? 0, c1: a.c ?? 0, r2: b.r ?? Infinity, c2: b.c ?? Infinity,
      fullCol: a.r === undefined, fullRow: a.c === undefined,
    };
  }

  // Rewrite every cell reference in a formula. mapPart(part, isEnd, sheet) returns a new part or null (→ #REF!).
  function rewriteRefs(formula, mapPart) {
    if (!formula.startsWith('=')) return formula;
    let toks;
    try { toks = tokenize(formula.slice(1)); } catch (e) { return formula; }
    let out = '', last = 0;
    const body = formula.slice(1);
    for (const t of toks) {
      if (t.t !== 'ref') continue;
      const a = mapPart({ ...t.a }, false, t.sheet, !!t.b);
      const b = t.b ? mapPart({ ...t.b }, true, t.sheet, true) : null;
      const prefix = REF_RE.exec(body.slice(t.s, t.e))[1] || '';
      const text = !a || (t.b && !b) ? '#REF!' : prefix + partText(a) + (b ? ':' + partText(b) : '');
      out += body.slice(last, t.s) + text;
      last = t.e;
    }
    return '=' + out + body.slice(last);
  }

  // Shift relative references by (dr, dc), as Excel does when copying a formula.
  function shiftFormula(formula, dr, dc) {
    return rewriteRefs(formula, (p) => {
      if (p.r !== undefined && !p.ar) p.r += dr;
      if (p.c !== undefined && !p.ac) p.c += dc;
      if ((p.r !== undefined && p.r < 0) || (p.c !== undefined && p.c < 0)) return null;
      return p;
    });
  }

  // ---------------------------------------------------------------- dates (serials are days since 1899-12-30, UTC)
  const EPOCH = Date.UTC(1899, 11, 30);
  const DAY_MS = 86400000;
  const dateToSerial = (y, m, d) => (Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS;
  const serialToDate = (s) => new Date(EPOCH + Math.round(s * DAY_MS));
  const nowSerial = () => (Date.now() - EPOCH) / DAY_MS;

  // ---------------------------------------------------------------- coercion
  function toNum(v) {
    if (isErr(v)) throw v;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof RangeVal) return toNum(v.rows[0][0]);
    const p = parseLiteral(String(v));
    if (typeof p.value === 'number') return p.value;
    throw err(E.VALUE);
  }
  function toStr(v) {
    if (isErr(v)) throw v;
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return formatGeneral(v);
    if (v instanceof RangeVal) return toStr(v.rows[0][0]);
    return String(v);
  }
  function toBool(v) {
    if (isErr(v)) throw v;
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (v instanceof RangeVal) return toBool(v.rows[0][0]);
    const s = String(v).toUpperCase();
    if (s === 'TRUE') return true;
    if (s === 'FALSE') return false;
    throw err(E.VALUE);
  }
  const scalar = (v) => (v instanceof RangeVal ? v.rows[0][0] : v);

  // Numbers in ranges count only if they are numbers; direct arguments are coerced.
  function numbers(args, { strict = false } = {}) {
    const out = [];
    for (const a of args) {
      if (a instanceof RangeVal) {
        for (const v of a.values()) { if (isErr(v)) throw v; if (typeof v === 'number') out.push(v); }
      } else if (a !== undefined) {
        if (strict && typeof a !== 'number') { if (isErr(a)) throw a; continue; }
        out.push(toNum(a));
      }
    }
    return out;
  }
  const flat = (args) => args.flatMap((a) => (a instanceof RangeVal ? [...a.values()] : [a]));

  // Excel ordering: numbers < text < booleans; text compares case-insensitively.
  function compare(a, b) {
    a = a ?? (typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0);
    b = b ?? (typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0);
    const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (typeof a === 'string') { a = a.toLowerCase(); b = b.toLowerCase(); }
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function wildcardRegex(pattern) {
    let re = '';
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === '~' && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      else if (ch === '*') re += '.*';
      else if (ch === '?') re += '.';
      else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + re + '$', 'is');
  }

  // Criteria used by COUNTIF / SUMIF / AVERAGEIF and their *IFS variants.
  function criteria(crit) {
    if (typeof crit === 'number') return (v) => typeof v === 'number' && v === crit;
    if (typeof crit === 'boolean') return (v) => v === crit;
    const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(toStr(crit));
    const op = m[1] || '=';
    const rhs = m[2];
    const lit = parseLiteral(rhs).value;
    if (typeof lit === 'number' || typeof lit === 'boolean') {
      return (v) => {
        if (op === '<>') return !(typeof v === typeof lit && v === lit);
        if (typeof v !== typeof lit) return false;
        const c = compare(v, lit);
        return { '=': c === 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[op];
      };
    }
    if (op === '=' || op === '<>') {
      const re = rhs === '' ? null : wildcardRegex(rhs);
      const test = (v) => (re ? typeof v === 'string' && re.test(v) : v === null || v === '');
      return op === '=' ? test : (v) => !test(v);
    }
    return (v) => {
      if (typeof v !== 'string') return false;
      const c = compare(v, rhs);
      return { '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[op];
    };
  }

  function lookupIndex(needle, list, approx) {
    if (!approx) {
      const test = typeof needle === 'string' ? wildcardRegex(needle) : null;
      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        if (test ? typeof v === 'string' && test.test(v) : v !== null && compare(v, needle) === 0 && typeof v === typeof needle) return i;
      }
      return -1;
    }
    let best = -1;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (v === null || typeof v !== typeof needle) continue;
      if (compare(v, needle) <= 0) best = i; else break;
    }
    return best;
  }

  const fact = (n) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
  const roundTo = (x, d) => { const f = 10 ** d; return Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9) / f; };
  const opt = (v, d) => (v === undefined || v === null ? d : v);

  // ---------------------------------------------------------------- function library
  // Each entry: [category, syntax, description, implementation]. Implementations receive evaluated args.
  const F = {};
  const def = (name, cat, syntax, desc, fn) => { F[name] = { cat, syntax, desc, fn }; };

  // Math & Trig
  def('SUM', 'Math & Trig', 'SUM(number1, [number2], ...)', 'Adds all the numbers in a range of cells.', (a) => numbers(a).reduce((s, x) => s + x, 0));
  def('PRODUCT', 'Math & Trig', 'PRODUCT(number1, [number2], ...)', 'Multiplies all the numbers given as arguments.', (a) => numbers(a).reduce((s, x) => s * x, 1));
  def('SUMPRODUCT', 'Math & Trig', 'SUMPRODUCT(array1, [array2], ...)', 'Returns the sum of the products of corresponding ranges or arrays.', (a) => {
    const arrs = a.map((x) => (x instanceof RangeVal ? [...x.values()] : [x]));
    const n = arrs[0].length;
    if (arrs.some((x) => x.length !== n)) throw err(E.VALUE);
    let s = 0;
    for (let i = 0; i < n; i++) s += arrs.reduce((p, arr) => p * (typeof arr[i] === 'number' ? arr[i] : 0), 1);
    return s;
  });
  def('ROUND', 'Math & Trig', 'ROUND(number, num_digits)', 'Rounds a number to a specified number of digits.', ([x, d]) => roundTo(toNum(x), toNum(opt(d, 0))));
  def('ROUNDUP', 'Math & Trig', 'ROUNDUP(number, num_digits)', 'Rounds a number up, away from zero.', ([x, d]) => { const f = 10 ** toNum(opt(d, 0)); x = toNum(x); return Math.sign(x) * Math.ceil(Math.abs(x) * f - 1e-9) / f; });
  def('ROUNDDOWN', 'Math & Trig', 'ROUNDDOWN(number, num_digits)', 'Rounds a number down, toward zero.', ([x, d]) => { const f = 10 ** toNum(opt(d, 0)); x = toNum(x); return Math.sign(x) * Math.floor(Math.abs(x) * f + 1e-9) / f; });
  def('INT', 'Math & Trig', 'INT(number)', 'Rounds a number down to the nearest integer.', ([x]) => Math.floor(toNum(x)));
  def('TRUNC', 'Math & Trig', 'TRUNC(number, [num_digits])', 'Truncates a number to an integer or given precision.', ([x, d]) => { const f = 10 ** toNum(opt(d, 0)); return Math.trunc(toNum(x) * f) / f; });
  def('ABS', 'Math & Trig', 'ABS(number)', 'Returns the absolute value of a number.', ([x]) => Math.abs(toNum(x)));
  def('SIGN', 'Math & Trig', 'SIGN(number)', 'Returns the sign of a number.', ([x]) => Math.sign(toNum(x)));
  def('SQRT', 'Math & Trig', 'SQRT(number)', 'Returns a positive square root.', ([x]) => { x = toNum(x); if (x < 0) throw err(E.NUM); return Math.sqrt(x); });
  def('POWER', 'Math & Trig', 'POWER(number, power)', 'Returns the result of a number raised to a power.', ([x, y]) => Math.pow(toNum(x), toNum(y)));
  def('EXP', 'Math & Trig', 'EXP(number)', 'Returns e raised to the power of a given number.', ([x]) => Math.exp(toNum(x)));
  def('LN', 'Math & Trig', 'LN(number)', 'Returns the natural logarithm of a number.', ([x]) => { x = toNum(x); if (x <= 0) throw err(E.NUM); return Math.log(x); });
  def('LOG', 'Math & Trig', 'LOG(number, [base])', 'Returns the logarithm of a number to the base you specify.', ([x, b]) => { x = toNum(x); if (x <= 0) throw err(E.NUM); return Math.log(x) / Math.log(toNum(opt(b, 10))); });
  def('LOG10', 'Math & Trig', 'LOG10(number)', 'Returns the base-10 logarithm of a number.', ([x]) => { x = toNum(x); if (x <= 0) throw err(E.NUM); return Math.log10(x); });
  def('MOD', 'Math & Trig', 'MOD(number, divisor)', 'Returns the remainder after a number is divided by a divisor.', ([x, y]) => { x = toNum(x); y = toNum(y); if (y === 0) throw err(E.DIV0); return x - y * Math.floor(x / y); });
  def('PI', 'Math & Trig', 'PI()', 'Returns the value of pi.', () => Math.PI);
  def('RAND', 'Math & Trig', 'RAND()', 'Returns a random number between 0 and 1.', () => Math.random());
  def('RANDBETWEEN', 'Math & Trig', 'RANDBETWEEN(bottom, top)', 'Returns a random integer between the numbers you specify.', ([a, b]) => { a = Math.ceil(toNum(a)); b = Math.floor(toNum(b)); return a + Math.floor(Math.random() * (b - a + 1)); });
  def('CEILING', 'Math & Trig', 'CEILING(number, significance)', 'Rounds a number up to the nearest multiple of significance.', ([x, s]) => { s = toNum(opt(s, 1)); return s === 0 ? 0 : Math.ceil(toNum(x) / s - 1e-12) * s; });
  def('FLOOR', 'Math & Trig', 'FLOOR(number, significance)', 'Rounds a number down to the nearest multiple of significance.', ([x, s]) => { s = toNum(opt(s, 1)); if (s === 0) throw err(E.DIV0); return Math.floor(toNum(x) / s + 1e-12) * s; });
  def('FACT', 'Math & Trig', 'FACT(number)', 'Returns the factorial of a number.', ([x]) => { x = Math.floor(toNum(x)); if (x < 0) throw err(E.NUM); return fact(x); });
  def('SUMIF', 'Math & Trig', 'SUMIF(range, criteria, [sum_range])', 'Adds the cells specified by a given condition or criteria.', ([range, crit, sumRange]) => {
    const test = criteria(scalar(crit));
    const src = [...range.values()];
    const sums = sumRange instanceof RangeVal ? [...sumRange.values()] : src;
    return src.reduce((s, v, i) => (test(v) && typeof sums[i] === 'number' ? s + sums[i] : s), 0);
  });
  def('SUMIFS', 'Math & Trig', 'SUMIFS(sum_range, criteria_range1, criteria1, ...)', 'Adds the cells specified by a given set of conditions.', ([sumRange, ...pairs]) => {
    const idx = matchAll(pairs);
    const sums = [...sumRange.values()];
    return idx.reduce((s, i) => (typeof sums[i] === 'number' ? s + sums[i] : s), 0);
  });

  // Statistical
  def('AVERAGE', 'Statistical', 'AVERAGE(number1, [number2], ...)', 'Returns the average (arithmetic mean) of its arguments.', (a) => { const n = numbers(a); if (!n.length) throw err(E.DIV0); return n.reduce((s, x) => s + x, 0) / n.length; });
  def('MIN', 'Statistical', 'MIN(number1, [number2], ...)', 'Returns the smallest number in a set of values.', (a) => { const n = numbers(a); return n.length ? Math.min(...n) : 0; });
  def('MAX', 'Statistical', 'MAX(number1, [number2], ...)', 'Returns the largest number in a set of values.', (a) => { const n = numbers(a); return n.length ? Math.max(...n) : 0; });
  def('MEDIAN', 'Statistical', 'MEDIAN(number1, [number2], ...)', 'Returns the median of the given numbers.', (a) => {
    const n = numbers(a).sort((x, y) => x - y);
    if (!n.length) throw err(E.NUM);
    const m = n.length >> 1;
    return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
  });
  def('COUNT', 'Statistical', 'COUNT(value1, [value2], ...)', 'Counts the number of cells in a range that contain numbers.', (a) => flat(a).filter((v) => typeof v === 'number').length);
  def('COUNTA', 'Statistical', 'COUNTA(value1, [value2], ...)', 'Counts the number of cells in a range that are not empty.', (a) => flat(a).filter((v) => v !== null && v !== undefined && v !== '').length);
  def('COUNTBLANK', 'Statistical', 'COUNTBLANK(range)', 'Counts the number of empty cells in a range.', (a) => flat(a).filter((v) => v === null || v === '').length);
  def('COUNTIF', 'Statistical', 'COUNTIF(range, criteria)', 'Counts the number of cells within a range that meet the given condition.', ([range, crit]) => {
    const test = criteria(scalar(crit));
    return [...range.values()].filter(test).length;
  });
  def('COUNTIFS', 'Statistical', 'COUNTIFS(criteria_range1, criteria1, ...)', 'Counts the number of cells specified by a given set of conditions.', (pairs) => matchAll(pairs).length);
  def('AVERAGEIF', 'Statistical', 'AVERAGEIF(range, criteria, [average_range])', 'Finds the average for the cells specified by a given condition.', ([range, crit, avgRange]) => {
    const test = criteria(scalar(crit));
    const src = [...range.values()];
    const vals = avgRange instanceof RangeVal ? [...avgRange.values()] : src;
    const hits = src.map((v, i) => (test(v) ? vals[i] : null)).filter((v) => typeof v === 'number');
    if (!hits.length) throw err(E.DIV0);
    return hits.reduce((s, x) => s + x, 0) / hits.length;
  });
  def('LARGE', 'Statistical', 'LARGE(array, k)', 'Returns the k-th largest value in a data set.', ([arr, k]) => { const n = numbers([arr]).sort((x, y) => y - x); const i = toNum(k) - 1; if (i < 0 || i >= n.length) throw err(E.NUM); return n[i]; });
  def('SMALL', 'Statistical', 'SMALL(array, k)', 'Returns the k-th smallest value in a data set.', ([arr, k]) => { const n = numbers([arr]).sort((x, y) => x - y); const i = toNum(k) - 1; if (i < 0 || i >= n.length) throw err(E.NUM); return n[i]; });
  const variance = (a, sample) => {
    const n = numbers(a);
    if (n.length < (sample ? 2 : 1)) throw err(E.DIV0);
    const mean = n.reduce((s, x) => s + x, 0) / n.length;
    return n.reduce((s, x) => s + (x - mean) ** 2, 0) / (n.length - (sample ? 1 : 0));
  };
  def('STDEV', 'Statistical', 'STDEV(number1, [number2], ...)', 'Estimates standard deviation based on a sample.', (a) => Math.sqrt(variance(a, true)));
  def('STDEV.S', 'Statistical', 'STDEV.S(number1, [number2], ...)', 'Estimates standard deviation based on a sample.', (a) => Math.sqrt(variance(a, true)));
  def('STDEV.P', 'Statistical', 'STDEV.P(number1, [number2], ...)', 'Calculates standard deviation based on the entire population.', (a) => Math.sqrt(variance(a, false)));
  def('VAR', 'Statistical', 'VAR(number1, [number2], ...)', 'Estimates variance based on a sample.', (a) => variance(a, true));
  def('RANK', 'Statistical', 'RANK(number, ref, [order])', 'Returns the rank of a number in a list of numbers.', ([x, ref, order]) => {
    x = toNum(x);
    const n = numbers([ref]);
    if (!n.includes(x)) throw err(E.NA);
    return 1 + n.filter((v) => (toNum(opt(order, 0)) ? v < x : v > x)).length;
  });

  // Logical (IF, IFS, IFERROR, IFNA, SWITCH, CHOOSE are evaluated lazily by the evaluator)
  def('IF', 'Logical', 'IF(logical_test, [value_if_true], [value_if_false])', 'Checks whether a condition is met, and returns one value if TRUE, and another value if FALSE.');
  def('IFS', 'Logical', 'IFS(logical_test1, value_if_true1, ...)', 'Checks whether one or more conditions are met and returns a value corresponding to the first TRUE condition.');
  def('IFERROR', 'Logical', 'IFERROR(value, value_if_error)', 'Returns value_if_error if expression is an error and the value of the expression itself otherwise.');
  def('IFNA', 'Logical', 'IFNA(value, value_if_na)', 'Returns the value you specify if the expression resolves to #N/A, otherwise returns the result of the expression.');
  def('SWITCH', 'Logical', 'SWITCH(expression, value1, result1, ..., [default])', 'Evaluates an expression against a list of values and returns the result corresponding to the first matching value.');
  def('AND', 'Logical', 'AND(logical1, [logical2], ...)', 'Checks whether all arguments are TRUE.', (a) => flat(a).filter((v) => v !== null && typeof v !== 'string').every(toBool));
  def('OR', 'Logical', 'OR(logical1, [logical2], ...)', 'Checks whether any of the arguments are TRUE.', (a) => flat(a).filter((v) => v !== null && typeof v !== 'string').some(toBool));
  def('XOR', 'Logical', 'XOR(logical1, [logical2], ...)', 'Returns a logical Exclusive Or of all arguments.', (a) => flat(a).filter((v) => v !== null && typeof v !== 'string').filter(toBool).length % 2 === 1);
  def('NOT', 'Logical', 'NOT(logical)', 'Changes FALSE to TRUE, or TRUE to FALSE.', ([x]) => !toBool(x));
  def('TRUE', 'Logical', 'TRUE()', 'Returns the logical value TRUE.', () => true);
  def('FALSE', 'Logical', 'FALSE()', 'Returns the logical value FALSE.', () => false);

  // Text
  def('CONCAT', 'Text', 'CONCAT(text1, [text2], ...)', 'Concatenates a list or range of text strings.', (a) => flat(a).map(toStr).join(''));
  def('CONCATENATE', 'Text', 'CONCATENATE(text1, [text2], ...)', 'Joins several text strings into one text string.', (a) => a.map(toStr).join(''));
  def('TEXTJOIN', 'Text', 'TEXTJOIN(delimiter, ignore_empty, text1, ...)', 'Concatenates a list or range of text strings using a delimiter.', ([d, ign, ...rest]) => {
    let parts = flat(rest).map(toStr);
    if (toBool(ign)) parts = parts.filter((s) => s !== '');
    return parts.join(toStr(d));
  });
  def('LEN', 'Text', 'LEN(text)', 'Returns the number of characters in a text string.', ([s]) => toStr(s).length);
  def('UPPER', 'Text', 'UPPER(text)', 'Converts text to uppercase.', ([s]) => toStr(s).toUpperCase());
  def('LOWER', 'Text', 'LOWER(text)', 'Converts text to lowercase.', ([s]) => toStr(s).toLowerCase());
  def('PROPER', 'Text', 'PROPER(text)', 'Capitalizes the first letter in each word of a text value.', ([s]) => toStr(s).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (m, p, ch) => p + ch.toUpperCase()));
  def('LEFT', 'Text', 'LEFT(text, [num_chars])', 'Returns the leftmost characters from a text value.', ([s, n]) => toStr(s).slice(0, toNum(opt(n, 1))));
  def('RIGHT', 'Text', 'RIGHT(text, [num_chars])', 'Returns the rightmost characters from a text value.', ([s, n]) => { s = toStr(s); n = toNum(opt(n, 1)); return n <= 0 ? '' : s.slice(-n); });
  def('MID', 'Text', 'MID(text, start_num, num_chars)', 'Returns a specific number of characters from a text string starting at the position you specify.', ([s, a, n]) => { a = toNum(a); if (a < 1) throw err(E.VALUE); return toStr(s).substr(a - 1, toNum(n)); });
  def('TRIM', 'Text', 'TRIM(text)', 'Removes all spaces from a text string except for single spaces between words.', ([s]) => toStr(s).trim().replace(/ +/g, ' '));
  def('SUBSTITUTE', 'Text', 'SUBSTITUTE(text, old_text, new_text, [instance_num])', 'Replaces existing text with new text in a text string.', ([s, o, n, inst]) => {
    s = toStr(s); o = toStr(o); n = toStr(n);
    if (!o) return s;
    if (inst === undefined) return s.split(o).join(n);
    let k = toNum(inst), i = -1;
    while (k-- > 0) { i = s.indexOf(o, i + 1); if (i < 0) return s; }
    return s.slice(0, i) + n + s.slice(i + o.length);
  });
  def('REPLACE', 'Text', 'REPLACE(old_text, start_num, num_chars, new_text)', 'Replaces part of a text string with a different text string.', ([s, a, n, t]) => { s = toStr(s); a = toNum(a) - 1; return s.slice(0, a) + toStr(t) + s.slice(a + toNum(n)); });
  def('FIND', 'Text', 'FIND(find_text, within_text, [start_num])', 'Returns the starting position of one text string within another (case-sensitive).', ([f, s, a]) => { const i = toStr(s).indexOf(toStr(f), toNum(opt(a, 1)) - 1); if (i < 0) throw err(E.VALUE); return i + 1; });
  def('SEARCH', 'Text', 'SEARCH(find_text, within_text, [start_num])', 'Returns the position of one text string within another (not case-sensitive, wildcards allowed).', ([f, s, a]) => {
    const re = new RegExp(wildcardRegex(toStr(f)).source.slice(1, -1), 'i');
    const start = toNum(opt(a, 1)) - 1;
    const m = re.exec(toStr(s).slice(start));
    if (!m) throw err(E.VALUE);
    return m.index + start + 1;
  });
  def('REPT', 'Text', 'REPT(text, number_times)', 'Repeats text a given number of times.', ([s, n]) => toStr(s).repeat(Math.max(0, toNum(n))));
  def('EXACT', 'Text', 'EXACT(text1, text2)', 'Checks whether two text strings are exactly the same.', ([a, b]) => toStr(a) === toStr(b));
  def('VALUE', 'Text', 'VALUE(text)', 'Converts a text string that represents a number to a number.', ([s]) => toNum(s));
  def('TEXT', 'Text', 'TEXT(value, format_text)', 'Converts a value to text in a specific number format.', ([v, f]) => formatPattern(scalar(v), toStr(f)));
  def('CHAR', 'Text', 'CHAR(number)', 'Returns the character specified by the code number.', ([n]) => String.fromCharCode(toNum(n)));
  def('CODE', 'Text', 'CODE(text)', 'Returns a numeric code for the first character in a text string.', ([s]) => { s = toStr(s); if (!s) throw err(E.VALUE); return s.charCodeAt(0); });

  // Lookup & Reference (ROW, COLUMN, CHOOSE are handled by the evaluator)
  def('VLOOKUP', 'Lookup & Reference', 'VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])', 'Looks for a value in the leftmost column of a table, and then returns a value in the same row from a column you specify.', ([v, table, col, approx]) => {
    if (!(table instanceof RangeVal)) throw err(E.VALUE);
    col = toNum(col);
    if (col < 1) throw err(E.VALUE);
    if (col > table.width) throw err(E.REF);
    const i = lookupIndex(scalar(v), table.column(0), toBool(opt(approx, true)));
    if (i < 0) throw err(E.NA);
    return table.rows[i][col - 1];
  });
  def('HLOOKUP', 'Lookup & Reference', 'HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])', 'Looks for a value in the top row of a table and returns the value in the same column from a row you specify.', ([v, table, row, approx]) => {
    if (!(table instanceof RangeVal)) throw err(E.VALUE);
    row = toNum(row);
    if (row < 1) throw err(E.VALUE);
    if (row > table.height) throw err(E.REF);
    const i = lookupIndex(scalar(v), table.rows[0], toBool(opt(approx, true)));
    if (i < 0) throw err(E.NA);
    return table.rows[row - 1][i];
  });
  def('XLOOKUP', 'Lookup & Reference', 'XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found])', 'Searches a range for a match and returns the corresponding item from a second range.', ([v, look, ret, notFound]) => {
    const list = [...look.values()];
    const i = lookupIndex(scalar(v), list, false);
    if (i < 0) { if (notFound !== undefined) return notFound; throw err(E.NA); }
    const out = ret.height === 1 && look.height === 1 ? ret.rows[0][i] : ret.rows[i][0];
    return out;
  });
  def('MATCH', 'Lookup & Reference', 'MATCH(lookup_value, lookup_array, [match_type])', 'Returns the relative position of an item in an array that matches a specified value.', ([v, arr, type]) => {
    const list = [...arr.values()];
    type = toNum(opt(type, 1));
    v = scalar(v);
    let i;
    if (type === 0) i = lookupIndex(v, list, false);
    else if (type > 0) i = lookupIndex(v, list, true);
    else { i = -1; for (let k = 0; k < list.length; k++) { if (list[k] !== null && compare(list[k], v) >= 0) i = k; else break; } }
    if (i < 0) throw err(E.NA);
    return i + 1;
  });
  def('INDEX', 'Lookup & Reference', 'INDEX(array, row_num, [column_num])', 'Returns a value from a table or range by row and column number.', ([arr, r, c]) => {
    if (!(arr instanceof RangeVal)) return arr;
    r = toNum(opt(r, 0)); c = toNum(opt(c, 0));
    if (arr.height === 1 && c === 0) { c = r; r = 1; }
    if (c === 0) c = 1;
    if (r === 0) r = 1;
    if (r > arr.height || c > arr.width || r < 1 || c < 1) throw err(E.REF);
    return arr.rows[r - 1][c - 1];
  });
  def('ROWS', 'Lookup & Reference', 'ROWS(array)', 'Returns the number of rows in a reference or array.', ([a]) => (a instanceof RangeVal ? a.height : 1));
  def('COLUMNS', 'Lookup & Reference', 'COLUMNS(array)', 'Returns the number of columns in a reference or array.', ([a]) => (a instanceof RangeVal ? a.width : 1));
  def('ROW', 'Lookup & Reference', 'ROW([reference])', 'Returns the row number of a reference.');
  def('COLUMN', 'Lookup & Reference', 'COLUMN([reference])', 'Returns the column number of a reference.');
  def('CHOOSE', 'Lookup & Reference', 'CHOOSE(index_num, value1, [value2], ...)', 'Chooses a value from a list of values, based on an index number.');

  // Date & Time
  const parts = (s) => serialToDate(toNum(s));
  def('TODAY', 'Date & Time', 'TODAY()', 'Returns the serial number of the current date (UTC).', () => Math.floor(nowSerial()));
  def('NOW', 'Date & Time', 'NOW()', 'Returns the serial number of the current date and time (UTC).', () => nowSerial());
  def('DATE', 'Date & Time', 'DATE(year, month, day)', 'Returns the number that represents the date.', ([y, m, d]) => dateToSerial(toNum(y), toNum(m), toNum(d)));
  def('TIME', 'Date & Time', 'TIME(hour, minute, second)', 'Converts hours, minutes and seconds given as numbers to a serial number.', ([h, m, s]) => ((toNum(h) * 3600 + toNum(m) * 60 + toNum(s)) / 86400) % 1);
  def('YEAR', 'Date & Time', 'YEAR(serial_number)', 'Returns the year of a date.', ([s]) => parts(s).getUTCFullYear());
  def('MONTH', 'Date & Time', 'MONTH(serial_number)', 'Returns the month of a date, from 1 (January) to 12 (December).', ([s]) => parts(s).getUTCMonth() + 1);
  def('DAY', 'Date & Time', 'DAY(serial_number)', 'Returns the day of the month, from 1 to 31.', ([s]) => parts(s).getUTCDate());
  def('HOUR', 'Date & Time', 'HOUR(serial_number)', 'Returns the hour as a number from 0 to 23.', ([s]) => parts(s).getUTCHours());
  def('MINUTE', 'Date & Time', 'MINUTE(serial_number)', 'Returns the minute, a number from 0 to 59.', ([s]) => parts(s).getUTCMinutes());
  def('SECOND', 'Date & Time', 'SECOND(serial_number)', 'Returns the second, a number from 0 to 59.', ([s]) => parts(s).getUTCSeconds());
  def('WEEKDAY', 'Date & Time', 'WEEKDAY(serial_number, [return_type])', 'Returns a number from 1 to 7 identifying the day of the week.', ([s, t]) => {
    const d = parts(s).getUTCDay();
    t = toNum(opt(t, 1));
    if (t === 2) return ((d + 6) % 7) + 1;
    if (t === 3) return (d + 6) % 7;
    return d + 1;
  });
  def('EDATE', 'Date & Time', 'EDATE(start_date, months)', 'Returns the serial number of the date that is the indicated number of months before or after the start date.', ([s, m]) => {
    const d = parts(s);
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + toNum(m), 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return dateToSerial(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(d.getUTCDate(), last));
  });
  def('EOMONTH', 'Date & Time', 'EOMONTH(start_date, months)', 'Returns the serial number of the last day of the month before or after a specified number of months.', ([s, m]) => {
    const d = parts(s);
    return (Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + toNum(m) + 1, 0) - EPOCH) / DAY_MS;
  });
  def('DAYS', 'Date & Time', 'DAYS(end_date, start_date)', 'Returns the number of days between two dates.', ([e, s]) => Math.floor(toNum(e)) - Math.floor(toNum(s)));

  // Financial
  def('PMT', 'Financial', 'PMT(rate, nper, pv, [fv], [type])', 'Calculates the payment for a loan based on constant payments and a constant interest rate.', ([rate, n, pv, fv, type]) => {
    rate = toNum(rate); n = toNum(n); pv = toNum(pv); fv = toNum(opt(fv, 0)); type = toNum(opt(type, 0));
    if (rate === 0) return -(pv + fv) / n;
    const f = (1 + rate) ** n;
    return -(rate * (pv * f + fv)) / ((1 + rate * type) * (f - 1));
  });
  def('FV', 'Financial', 'FV(rate, nper, pmt, [pv], [type])', 'Returns the future value of an investment based on periodic, constant payments and a constant interest rate.', ([rate, n, pmt, pv, type]) => {
    rate = toNum(rate); n = toNum(n); pmt = toNum(pmt); pv = toNum(opt(pv, 0)); type = toNum(opt(type, 0));
    if (rate === 0) return -(pv + pmt * n);
    const f = (1 + rate) ** n;
    return -(pv * f + pmt * (1 + rate * type) * (f - 1) / rate);
  });
  def('PV', 'Financial', 'PV(rate, nper, pmt, [fv], [type])', 'Returns the present value of an investment.', ([rate, n, pmt, fv, type]) => {
    rate = toNum(rate); n = toNum(n); pmt = toNum(pmt); fv = toNum(opt(fv, 0)); type = toNum(opt(type, 0));
    if (rate === 0) return -(fv + pmt * n);
    const f = (1 + rate) ** n;
    return -(fv + pmt * (1 + rate * type) * (f - 1) / rate) / f;
  });
  def('NPV', 'Financial', 'NPV(rate, value1, [value2], ...)', 'Returns the net present value of an investment based on a discount rate and a series of future payments.', ([rate, ...vals]) => {
    rate = toNum(rate);
    return numbers(vals).reduce((s, v, i) => s + v / (1 + rate) ** (i + 1), 0);
  });

  // Information
  def('ISBLANK', 'Information', 'ISBLANK(value)', 'Checks whether a reference is to an empty cell.', ([v]) => scalar(v) === null || scalar(v) === undefined);
  def('ISNUMBER', 'Information', 'ISNUMBER(value)', 'Checks whether a value is a number.', ([v]) => typeof scalar(v) === 'number');
  def('ISTEXT', 'Information', 'ISTEXT(value)', 'Checks whether a value is text.', ([v]) => typeof scalar(v) === 'string');
  def('ISLOGICAL', 'Information', 'ISLOGICAL(value)', 'Checks whether a value is a logical value (TRUE or FALSE).', ([v]) => typeof scalar(v) === 'boolean');
  def('ISERROR', 'Information', 'ISERROR(value)', 'Checks whether a value is an error.', ([v]) => isErr(scalar(v)));
  def('ISNA', 'Information', 'ISNA(value)', 'Checks whether a value is #N/A.', ([v]) => isErr(scalar(v)) && scalar(v).code === E.NA);
  def('ISEVEN', 'Information', 'ISEVEN(number)', 'Returns TRUE if the number is even.', ([v]) => Math.trunc(toNum(v)) % 2 === 0);
  def('ISODD', 'Information', 'ISODD(number)', 'Returns TRUE if the number is odd.', ([v]) => Math.abs(Math.trunc(toNum(v)) % 2) === 1);
  def('NA', 'Information', 'NA()', 'Returns the error value #N/A.', () => { throw err(E.NA); });

  // Functions whose error arguments are inspected rather than propagated.
  const ERROR_TOLERANT = new Set(['ISERROR', 'ISNA', 'COUNT', 'COUNTA', 'COUNTBLANK', 'ISBLANK', 'ISNUMBER', 'ISTEXT', 'ISLOGICAL', 'XLOOKUP', 'INDEX', 'VLOOKUP', 'HLOOKUP', 'MATCH', 'COUNTIF', 'COUNTIFS', 'ROWS', 'COLUMNS']);

  function matchAll(pairs) {
    if (pairs.length % 2) throw err(E.VALUE);
    let idx = null;
    for (let p = 0; p < pairs.length; p += 2) {
      const test = criteria(scalar(pairs[p + 1]));
      const vals = [...pairs[p].values()];
      const hits = vals.map((v, i) => (test(v) ? i : -1)).filter((i) => i >= 0);
      idx = idx === null ? hits : idx.filter((i) => hits.includes(i));
    }
    return idx || [];
  }

  // ---------------------------------------------------------------- literal parsing & formatting
  // Parses typed cell content into a value and an implied number format (like Excel's entry parsing).
  function parseLiteral(text) {
    const s = text.trim();
    if (s === '') return { value: null };
    if (/^(TRUE|FALSE)$/i.test(s)) return { value: s.toUpperCase() === 'TRUE' };
    if (ERROR_CODES.includes(s.toUpperCase())) return { value: err(s.toUpperCase()) };
    let m;
    if ((m = /^([-+]?)\$\s?([\d,]*\.?\d+)$/.exec(s)) && /^\d{1,3}(,\d{3})*(\.\d+)?$|^\d*\.?\d+$/.test(m[2])) {
      return { value: (m[1] === '-' ? -1 : 1) * parseFloat(m[2].replace(/,/g, '')), fmt: 'currency' };
    }
    if ((m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)%$/i.exec(s))) return { value: parseFloat(m[1]) / 100, fmt: 'percent' };
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return { value: parseFloat(s) };
    if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return { value: parseFloat(s.replace(/,/g, '')), fmt: 'number' };
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))) {
      const [, y, mo, d, h, mi, se] = m;
      if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) {
        const t = h !== undefined ? (+h * 3600 + +mi * 60 + +(se || 0)) / 86400 : 0;
        return { value: dateToSerial(+y, +mo, +d) + t, fmt: h !== undefined ? 'datetime' : 'date' };
      }
    }
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)) && +m[1] <= 12 && +m[2] <= 31) {
      return { value: dateToSerial(+m[3], +m[1], +m[2]), fmt: 'date' };
    }
    if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s)) && +m[1] < 24) {
      return { value: (+m[1] * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400, fmt: 'time' };
    }
    return { value: text };
  }

  function formatGeneral(n) {
    if (!isFinite(n)) return E.NUM;
    if (n === 0) return '0';
    const abs = Math.abs(n);
    if (abs >= 1e11 || abs < 1e-9) {
      return n.toExponential(5).replace(/\.?0+e/, 'E').replace(/E([+-])(\d)$/, 'E$10$2').toUpperCase();
    }
    return String(parseFloat(n.toPrecision(abs >= 1 ? 11 : 10)));
  }

  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS_ = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function formatDate(serial, pattern) {
    const d = serialToDate(serial);
    const map = {
      yyyy: d.getUTCFullYear(), yy: pad(d.getUTCFullYear() % 100),
      mmmm: MONTHS[d.getUTCMonth()], mmm: MONTHS[d.getUTCMonth()].slice(0, 3),
      mm: pad(d.getUTCMonth() + 1), m: d.getUTCMonth() + 1,
      dddd: DAYS_[d.getUTCDay()], ddd: DAYS_[d.getUTCDay()].slice(0, 3),
      dd: pad(d.getUTCDate()), d: d.getUTCDate(),
      hh: pad(d.getUTCHours()), h: d.getUTCHours(),
      nn: pad(d.getUTCMinutes()), ss: pad(d.getUTCSeconds()),
    };
    // "mm" directly after h/hh or before ss means minutes.
    const p = pattern.replace(/(h+[^a-z]*)mm/gi, '$1nn').replace(/mm([^a-z]*s)/gi, 'nn$1');
    return p.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|nn|ss/gi, (t) => map[t.toLowerCase()]);
  }

  function formatNumber(n, decimals, thousands) {
    const s = Math.abs(n).toFixed(decimals);
    let [int, frac] = s.split('.');
    if (thousands) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 && Number(s) !== 0 ? '-' : '') + int + (frac ? '.' + frac : '');
  }

  // ---------------------------------------------------------------- Excel number-format codes
  // Implements Excel's format-code language for custom formats and TEXT(): up to four sections
  // (positive;negative;zero;text), [Color] and [condition] prefixes, quoted and \ literals, _ spacing,
  // * fill, 0 # ? digit placeholders, thousands and scaling commas, %, E+ scientific, fractions,
  // @ text, General, and date/time codes including AM/PM and elapsed [h]:mm:ss.
  const CODE_COLORS = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#00ff00', blue: '#0000ff', yellow: '#ffff00', magenta: '#ff00ff', cyan: '#00ffff' };
  function splitSections(code) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (q) { cur += ch; if (ch === '"') q = false; continue; }
      if (ch === '"') { q = true; cur += ch; continue; }
      if (ch === '\\' || ch === '_' || ch === '*') { cur += ch + (code[i + 1] ?? ''); i++; continue; }
      if (ch === '[') { const j = code.indexOf(']', i); if (j > i) { cur += code.slice(i, j + 1); i = j; continue; } }
      if (ch === ';') { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  // Splits a section into tokens: literals, placeholders, date parts, brackets.
  function lexSection(sec) {
    const toks = [];
    let color = null, cond = null;
    const lit = (v) => { const last = toks[toks.length - 1]; if (last && last.t === 'lit') last.v += v; else toks.push({ t: 'lit', v }); };
    for (let i = 0; i < sec.length; i++) {
      const ch = sec[i], rest = sec.slice(i);
      let m;
      if (ch === '"') { const j = sec.indexOf('"', i + 1); lit(sec.slice(i + 1, j < 0 ? undefined : j)); i = j < 0 ? sec.length : j; continue; }
      if (ch === '\\') { lit(sec[i + 1] ?? ''); i++; continue; }
      if (ch === '_') { lit(' '); i++; continue; }
      if (ch === '*') { lit(sec[i + 1] === ' ' ? ' ' : ''); i++; continue; }
      if (ch === '[') {
        const j = sec.indexOf(']', i), inner = sec.slice(i + 1, j);
        i = j;
        if ((m = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(inner))) { cond = { op: m[1], n: +m[2] }; continue; }
        if (CODE_COLORS[inner.toLowerCase()]) { color = CODE_COLORS[inner.toLowerCase()]; continue; }
        if (/^color\d+$/i.test(inner)) continue;
        if (/^(h+|m+|s+)$/i.test(inner)) { toks.push({ t: 'date', v: inner.toLowerCase(), elapsed: true }); continue; }
        if (inner[0] === '$') { lit(inner.slice(1).split('-')[0]); continue; }
        continue;
      }
      if (/^general/i.test(rest)) { toks.push({ t: 'general' }); i += 6; continue; }
      if ((m = /^(am\/pm|a\/p)/i.exec(rest))) { toks.push({ t: 'ampm', v: m[1] }); i += m[1].length - 1; continue; }
      if ((m = /^(y+|m+|d+|h+|s+)/i.exec(rest))) { toks.push({ t: 'date', v: m[1].toLowerCase() }); i += m[1].length - 1; continue; }
      if ('0#?'.includes(ch)) { toks.push({ t: 'ph', v: ch }); continue; }
      if (ch === '.') { toks.push({ t: 'dot' }); continue; }
      if (ch === ',') { toks.push({ t: 'comma' }); continue; }
      if (ch === '%') { toks.push({ t: 'pct' }); continue; }
      if (ch === '@') { toks.push({ t: 'text' }); continue; }
      if ((ch === 'E' || ch === 'e') && (sec[i + 1] === '+' || sec[i + 1] === '-')) { toks.push({ t: 'exp', v: sec[i + 1] }); i++; continue; }
      if (ch === '/' && toks.some((t) => t.t === 'ph')) { toks.push({ t: 'slash' }); continue; }
      lit(ch);
    }
    return { toks, color, cond };
  }
  const testCond = (c, v) => ({ '<': v < c.n, '>': v > c.n, '=': v === c.n, '<=': v <= c.n, '>=': v >= c.n, '<>': v !== c.n }[c.op]);

  function fmtDateToks(v, toks) {
    const hasAmPm = toks.some((t) => t.t === 'ampm');
    // "m"/"mm" right after an hour or right before seconds means minutes.
    const parts = toks.map((t) => ({ ...t }));
    const dateIdx = parts.map((t, i) => (t.t === 'date' ? i : -1)).filter((i) => i >= 0);
    dateIdx.forEach((i, k) => {
      const t = parts[i];
      if (t.v[0] !== 'm' || t.v.length > 2 || t.elapsed) return;
      const prev = parts[dateIdx[k - 1]], next = parts[dateIdx[k + 1]];
      if ((prev && prev.v[0] === 'h') || (next && next.v[0] === 's')) t.min = true;
    });
    const fracTok = toks.findIndex((t, i) => t.t === 'dot' && toks[i + 1] && toks[i + 1].t === 'ph' && toks[i - 1] && toks[i - 1].t === 'date' && toks[i - 1].v[0] === 's');
    let fracDigits = 0;
    if (fracTok >= 0) for (let i = fracTok + 1; toks[i] && toks[i].t === 'ph'; i++) fracDigits++;
    const total = v * 86400;
    const rounded = Math.round(total * 10 ** fracDigits) / 10 ** fracDigits;
    const whole = Math.floor(rounded), frac = rounded - whole;
    const d = serialToDate(Math.floor(v));
    const secs = whole - Math.floor(v) * 86400;
    const H = Math.floor(secs / 3600), M = Math.floor((secs % 3600) / 60), Sx = secs % 60;
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i];
      if (t.t === 'lit') out += t.v;
      else if (t.t === 'ampm') out += t.v.length > 3 ? (H < 12 ? 'AM' : 'PM') : (H < 12 ? 'A' : 'P');
      else if (t.t === 'dot' && i === fracTok) { out += '.' + frac.toFixed(fracDigits).slice(2); while (parts[i + 1] && parts[i + 1].t === 'ph') i++; }
      else if (t.t === 'date') {
        const n = t.v.length, c = t.v[0];
        if (t.elapsed) out += pad(c === 'h' ? Math.floor(total / 3600) : c === 'm' ? Math.floor(total / 60) : Math.floor(total), n);
        else if (c === 'y') out += n <= 2 ? pad(d.getUTCFullYear() % 100) : d.getUTCFullYear();
        else if (c === 'm' && t.min) out += n === 1 ? M : pad(M);
        else if (c === 'm') out += n === 1 ? d.getUTCMonth() + 1 : n === 2 ? pad(d.getUTCMonth() + 1) : n === 3 ? MONTHS[d.getUTCMonth()].slice(0, 3) : n === 5 ? MONTHS[d.getUTCMonth()][0] : MONTHS[d.getUTCMonth()];
        else if (c === 'd') out += n === 1 ? d.getUTCDate() : n === 2 ? pad(d.getUTCDate()) : n === 3 ? DAYS_[d.getUTCDay()].slice(0, 3) : DAYS_[d.getUTCDay()];
        else if (c === 'h') { const h = hasAmPm ? (H % 12 || 12) : H; out += n === 1 ? h : pad(h); }
        else if (c === 's') out += n === 1 ? Sx : pad(Sx);
      } else if (t.t === 'ph' || t.t === 'dot' || t.t === 'comma' || t.t === 'pct' || t.t === 'slash') out += { ph: t.v, dot: '.', comma: ',', pct: '%', slash: '/' }[t.t];
    }
    return out;
  }

  // Best fraction for x with a denominator of at most maxDen digits, or exactly `fixed`.
  function toFraction(x, maxDen, fixed) {
    if (fixed) return [Math.round(x * fixed), fixed];
    let best = [0, 1], err = Infinity;
    for (let den = 1; den <= maxDen; den++) {
      const num = Math.round(x * den), e = Math.abs(x - num / den);
      if (e < err - 1e-12) { best = [num, den]; err = e; }
    }
    return best;
  }

  function fmtNumberToks(v, toks, signed) {
    let x = Math.abs(v);
    const neg = signed && v < 0;
    const phIdx = toks.map((t, i) => (t.t === 'ph' ? i : -1)).filter((i) => i >= 0);
    const pct = toks.filter((t) => t.t === 'pct').length;
    x *= 100 ** pct;
    const dotAt = toks.findIndex((t) => t.t === 'dot');
    const expAt = toks.findIndex((t) => t.t === 'exp');
    const slashAt = toks.findIndex((t) => t.t === 'slash');
    const lastPh = phIdx[phIdx.length - 1] ?? -1;
    const intEnd = dotAt >= 0 ? dotAt : expAt >= 0 ? expAt : slashAt >= 0 ? slashAt : lastPh + 1;
    // Commas right after the last integer placeholder scale by 1000; commas between placeholders group thousands.
    let scale = 0, group = false;
    toks.forEach((t, i) => {
      if (t.t !== 'comma') return;
      const before = phIdx.some((p) => p < i), after = phIdx.some((p) => p > i && p < intEnd);
      if (before && after && i < intEnd) group = true;
      else if (before && !after) scale++;
    });
    x /= 1000 ** scale;
    const fracPh = dotAt >= 0 ? phIdx.filter((p) => p > dotAt && (expAt < 0 || p < expAt)) : [];
    let intPh = phIdx.filter((p) => p < intEnd);
    let expPh = expAt >= 0 ? phIdx.filter((p) => p > expAt) : [];
    let exponent = 0;
    if (expAt >= 0 && x !== 0) {
      const intDigits = Math.max(1, intPh.length);
      exponent = Math.floor(Math.log10(x)) - (intDigits - 1);
      x /= 10 ** exponent;
      if (+x.toFixed(fracPh.length) >= 10 ** intDigits) { x /= 10; exponent++; }
    }
    // Fractions: "# ?/?" (integer, numerator, denominator) or "?/?".
    let fracParts = null;
    if (slashAt >= 0) {
      const numPh = phIdx.filter((p) => p < slashAt && !intPh.slice(0, -0).includes(p));
      const denToks = [];
      for (let i = slashAt + 1; i < toks.length && (toks[i].t === 'ph' || (toks[i].t === 'lit' && /^\d+$/.test(toks[i].v))); i++) denToks.push(toks[i]);
      const fixed = denToks.length === 1 && denToks[0].t === 'lit' ? +denToks[0].v : null;
      // The numerator is the run of placeholders just before "/"; any earlier placeholders are the integer part.
      let k = slashAt - 1;
      const numRun = [];
      while (k >= 0 && toks[k].t === 'ph') numRun.unshift(k--);
      const intRun = phIdx.filter((p) => p < (numRun[0] ?? slashAt));
      const hasInt = intRun.length > 0;
      const whole = hasInt ? Math.floor(x) : 0;
      const [num, den] = toFraction(x - whole, 10 ** Math.max(1, denToks.filter((t) => t.t === 'ph').length) - 1, fixed);
      let w = whole, n = num;
      if (fixed ? n === den : n === den) { w += 1; n = 0; }
      fracParts = { intRun, numRun, denToks, w, n, d: den, hasInt };
      intPh = intRun;
    }
    const decimals = fracPh.length;
    let intStr, fracStr = '';
    if (fracParts) intStr = String(fracParts.w);
    else {
      const fixedS = x.toFixed(decimals);
      [intStr, fracStr = ''] = fixedS.split('.');
    }
    if (intStr === '0' && !intPh.some((p) => toks[p].v === '0')) intStr = '';
    // Fill integer placeholders right to left; spare leading digits go before the first one.
    const fill = new Map();
    const intDigits = intStr.split('');
    for (let k = intPh.length - 1; k >= 0; k--) {
      const ph = toks[intPh[k]].v;
      const dgt = intDigits.length ? intDigits.pop() : null;
      fill.set(intPh[k], dgt ?? (ph === '0' ? '0' : ph === '?' ? ' ' : ''));
    }
    if (intPh.length && intDigits.length) fill.set(intPh[0], intDigits.join('') + fill.get(intPh[0]));
    if (group && intPh.length) {
      // Re-render the integer run with thousands separators.
      const digits = intPh.map((p) => fill.get(p)).join('');
      const trimmed = digits.replace(/^ +/, '');
      const grouped = trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      intPh.forEach((p, k) => fill.set(p, k === 0 ? ' '.repeat(digits.length - trimmed.length) + grouped : ''));
    }
    // Decimal placeholders left to right; trailing zeros drop for # and become spaces for ?.
    const fd = fracStr.split('');
    let keep = fd.length;
    while (keep > 0 && fd[keep - 1] === '0' && toks[fracPh[keep - 1]].v !== '0') keep--;
    fracPh.forEach((p, k) => fill.set(p, k < keep ? fd[k] : toks[p].v === '?' ? ' ' : ''));
    if (expAt >= 0) {
      const es = String(Math.abs(exponent)).padStart(expPh.filter((p) => toks[p].v === '0').length, '0');
      expPh.forEach((p, k) => fill.set(p, k === 0 ? es : ''));
    }
    if (fracParts) {
      const { numRun, denToks, n, d, w, hasInt } = fracParts;
      const showFrac = n !== 0 || !hasInt;
      const ns = String(n), ds = String(d);
      numRun.forEach((p, k) => fill.set(p, k === numRun.length - 1 ? (showFrac ? ns.padStart(numRun.length, ' ') : ' '.repeat(numRun.length)) : ''));
      fill.set('den', showFrac ? ds.padEnd(denToks.filter((t) => t.t === 'ph').length, ' ') : ' '.repeat(denToks.length));
      if (hasInt && w === 0 && n !== 0) fracParts.intRun.forEach((p) => { if (toks[p].v === '#') fill.set(p, ''); });
      fracParts.showFrac = showFrac;
    }
    let out = '';
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'ph') out += fill.get(i) ?? '';
      else if (t.t === 'lit') out += t.v;
      else if (t.t === 'dot') out += '.';
      else if (t.t === 'pct') out += '%';
      else if (t.t === 'exp') out += 'E' + (exponent < 0 ? '-' : t.v === '+' ? '+' : '');
      else if (t.t === 'slash') {
        out += fracParts.showFrac ? '/' : ' ';
        out += fill.get('den');
        i += fracParts.denToks.length;
      } else if (t.t === 'general') out += formatGeneral(x);
      else if (t.t === 'date') out += t.v;
    }
    if (neg && /[1-9]/.test(out)) out = '-' + out;
    return out;
  }

  function formatCode(v, code) {
    const raw = code == null || code === '' ? 'General' : String(code);
    const secs = splitSections(raw).map(lexSection);
    if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', color: null };
    if (typeof v === 'string') {
      const tsec = secs.length >= 4 ? secs[3] : secs.find((s) => s.toks.some((t) => t.t === 'text'));
      if (!tsec) return { text: v, color: null };
      return { text: tsec.toks.map((t) => (t.t === 'text' ? v : t.t === 'lit' ? t.v : '')).join(''), color: tsec.color };
    }
    if (typeof v !== 'number' || !isFinite(v)) return { text: toStr(v), color: null };
    let sec, signed = true;
    if (secs.some((s) => s.cond)) {
      const conds = secs.filter((s) => s.cond);
      sec = conds.find((s) => testCond(s.cond, v)) || secs.find((s) => !s.cond && !s.toks.some((t) => t.t === 'text')) || secs[0];
      signed = !(sec !== secs[0] && v < 0 && !sec.cond && secs.indexOf(sec) === 1);
    } else if (v < 0 && secs.length >= 2 && secs[1].toks.length) { sec = secs[1]; signed = false; }
    else if (v === 0 && secs.length >= 3 && secs[2].toks.length) sec = secs[2];
    else sec = secs[0];
    const { toks, color } = sec;
    const only = toks.filter((t) => t.t !== 'lit');
    if (!only.length && !toks.length) return { text: '', color };
    if (only.length === 1 && only[0].t === 'general' || toks.every((t) => t.t === 'lit' || t.t === 'general') && toks.some((t) => t.t === 'general')) {
      const g = formatGeneral(signed ? v : Math.abs(v));
      return { text: toks.map((t) => (t.t === 'general' ? g : t.v)).join(''), color };
    }
    if (toks.some((t) => t.t === 'text') && !toks.some((t) => t.t === 'ph')) return { text: toks.map((t) => (t.t === 'text' ? formatGeneral(v) : t.t === 'lit' ? t.v : '')).join(''), color };
    const isDate = toks.some((t) => t.t === 'date' || t.t === 'ampm') && !toks.some((t, i) => t.t === 'ph' && !(toks[i - 1] && (toks[i - 1].t === 'dot' || toks[i - 1].t === 'ph') && toks.slice(0, i).some((x) => x.t === 'date' && x.v[0] === 's')));
    if (isDate) return { text: v < 0 ? '#'.repeat(8) : fmtDateToks(v, toks), color };
    if (!toks.some((t) => t.t === 'ph')) return { text: toks.map((t) => (t.t === 'lit' ? t.v : t.t === 'pct' ? '%' : '')).join(''), color };
    return { text: fmtNumberToks(v, toks, signed), color };
  }

  // TEXT() and older callers: format code to text. Text that looks like a number is formatted as one.
  function formatPattern(v, pattern) {
    if (typeof v === 'string') { const lit = parseLiteral(v).value; if (typeof lit === 'number') v = lit; }
    return formatCode(v, pattern).text;
  }

  // Formats a cell value for display using the cell's style (number format + decimal override).
  function formatValue(v, style = {}) {
    if (v === null || v === undefined) return '';
    if (isErr(v)) return v.code;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'string') return style.fmt === 'custom' ? formatCode(v, style.pattern).text : v;
    const fmt = style.fmt || 'general';
    const dec = style.dec;
    // Number and Currency take Excel's negative styles: style.neg = 'red' | 'paren' | 'redparen' (default "-").
    const sym = style.sym === 'none' ? '' : '$';
    const signed = (body, isNeg) => (!isNeg ? body : style.neg === 'paren' || style.neg === 'redparen' ? `(${body})` : style.neg === 'red' ? body : '-' + body);
    switch (fmt) {
      case 'number': {
        const s = formatNumber(Math.abs(v), dec ?? 2, style.sep !== false);
        return signed(s, v < 0 && /[1-9]/.test(s));
      }
      case 'currency': {
        const s = formatNumber(Math.abs(v), dec ?? 2, true);
        return signed(sym + s, v < 0 && /[1-9]/.test(s));
      }
      case 'accounting': {
        const s = formatNumber(Math.abs(v), dec ?? 2, true);
        const lead = sym ? sym + ' ' : '';
        return v < 0 ? `${lead}(${s})` : v === 0 ? `${lead}-` : `${lead}${s}`;
      }
      case 'percent': return formatNumber(v * 100, dec ?? 2, false) + '%';
      case 'scientific': return v.toExponential(dec ?? 2).toUpperCase().replace(/E([+-])(\d)$/, 'E$10$2');
      case 'date': return formatDate(v, 'yyyy-mm-dd');
      case 'longdate': return formatDate(v, 'dddd, mmmm d, yyyy');
      case 'datetime': return formatDate(v, 'yyyy-mm-dd hh:mm');
      case 'time': return formatDate(v, 'hh:mm:ss');
      case 'text': return formatGeneral(v);
      case 'custom': return formatCode(v, style.pattern || 'General').text;
      default:
        if (dec !== undefined) return formatNumber(v, dec, false);
        return formatGeneral(v);
    }
  }

  // The colour a number format gives a value: red negatives, or a [Color] in a custom code.
  function formatColor(v, style = {}) {
    if (typeof v !== 'number') return style.fmt === 'custom' && typeof v === 'string' ? formatCode(v, style.pattern).color : null;
    if (style.fmt === 'custom') return formatCode(v, style.pattern).color;
    if ((style.fmt === 'number' || style.fmt === 'currency') && v < 0 && (style.neg === 'red' || style.neg === 'redparen')) return '#ff0000';
    return null;
  }

  // ---------------------------------------------------------------- workbook model
  const key = (r, c) => r + ',' + c;

  class Sheet {
    constructor(name) {
      this.name = name;
      this.cells = new Map();
      this.colWidths = {};
      this.rowHeights = {};
      this.view = {};
      this.merges = []; // merged ranges { r1, c1, r2, c2 }; the top-left cell holds the value
      this.hiddenRows = {}; // index -> true
      this.hiddenCols = {};
      this.hidden = false; // hidden sheet
      this.tabColor = null;
      this.defaultColWidth = null; // px; null = the app default
    }
    get(r, c) { return this.cells.get(key(r, c)); }
    extent() {
      let rows = 0, cols = 0;
      for (const [k, cell] of this.cells) {
        if (cell.input === '' && !cell.style) continue;
        const [r, c] = k.split(',').map(Number);
        rows = Math.max(rows, r + 1);
        cols = Math.max(cols, c + 1);
      }
      return { rows, cols };
    }
  }

  class Workbook {
    constructor() {
      this.sheets = [];
      this.cellStyles = []; // custom cell styles: { name, inc: [categories], def: style props }
      this.calcId = 1;
      this.circular = null;
    }

    addSheet(name, index = this.sheets.length) {
      if (!name) {
        let n = this.sheets.length + 1;
        while (this.sheetIndex('Sheet' + n) >= 0) n++;
        name = 'Sheet' + n;
      }
      const sh = new Sheet(name);
      this.sheets.splice(index, 0, sh);
      this.recalc();
      return sh;
    }
    sheetIndex(name) {
      const lower = name.toLowerCase();
      return this.sheets.findIndex((s) => s.name.toLowerCase() === lower);
    }
    renameSheet(si, name) {
      const old = this.sheets[si].name;
      this.sheets[si].name = name;
      // Update references in every formula that points at the renamed sheet.
      const quoted = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
      for (const sh of this.sheets) {
        for (const cell of sh.cells.values()) {
          if (!cell.formula) continue;
          let toks;
          try { toks = tokenize(cell.input.slice(1)); } catch (e) { continue; }
          let body = cell.input.slice(1);
          for (const t of toks.reverse()) {
            if (t.t === 'ref' && t.sheet && t.sheet.toLowerCase() === old.toLowerCase()) {
              const text = body.slice(t.s, t.e);
              body = body.slice(0, t.s) + quoted + text.slice(text.indexOf('!')) + body.slice(t.e);
            }
          }
          this.setCellInput(cell, '=' + body);
        }
      }
      this.recalc();
    }

    // Returns { ok: true } or { ok: false, message } when the formula cannot be parsed.
    setInput(si, r, c, input) {
      const sh = this.sheets[si];
      const k = key(r, c);
      let cell = sh.cells.get(k);
      if (input === '' && (!cell || !cell.style)) { sh.cells.delete(k); this.recalc(); return { ok: true }; }
      if (!cell) { cell = { input: '' }; sh.cells.set(k, cell); }
      const res = this.setCellInput(cell, input);
      if (!res.ok) return res;
      if (res.fmt && (!cell.style || !cell.style.fmt)) cell.style = { ...(cell.style || {}), fmt: res.fmt };
      this.recalc();
      return { ok: true };
    }
    setCellInput(cell, input) {
      if (input.startsWith('=') && input.length > 1) {
        let ast;
        try { ast = parse(input.slice(1)); } catch (e) { return { ok: false, message: e.message }; }
        Object.assign(cell, { input, formula: true, ast, value: undefined });
        return { ok: true };
      }
      const lit = input.startsWith("'") ? { value: input.slice(1) } : parseLiteral(input);
      Object.assign(cell, { input, formula: false, ast: null, value: lit.value });
      return { ok: true, fmt: lit.fmt };
    }
    getInput(si, r, c) { const cell = this.sheets[si].get(r, c); return cell ? cell.input : ''; }
    getStyle(si, r, c) { const cell = this.sheets[si].get(r, c); return (cell && cell.style) || {}; }
    // Merges `patch` into the cell's style, or replaces the style entirely when replace is true.
    setStyle(si, r, c, patch, replace = false) {
      const sh = this.sheets[si];
      const k = key(r, c);
      let cell = sh.cells.get(k);
      if (!cell) { cell = { input: '', formula: false, value: null }; sh.cells.set(k, cell); }
      const style = replace ? { ...(patch || {}) } : { ...(cell.style || {}), ...patch };
      for (const p in style) if (style[p] === undefined || style[p] === null || style[p] === false) delete style[p];
      cell.style = Object.keys(style).length ? style : undefined;
      if (!cell.style && cell.input === '') sh.cells.delete(k);
    }

    recalc() { this.calcId++; this.circular = null; }

    getValue(si, r, c) {
      const cell = this.sheets[si] && this.sheets[si].get(r, c);
      if (!cell) return null;
      if (!cell.formula) return cell.value === undefined ? null : cell.value;
      if (cell.calcId === this.calcId) return cell.cache;
      if (cell.computing) {
        if (!this.circular) this.circular = { si, r, c };
        return 0;
      }
      cell.computing = true;
      let v;
      try {
        v = this.evaluate(cell.ast, { si, r, c });
        if (v instanceof RangeVal) v = v.rows.length && v.rows[0].length ? v.rows[0][0] : err(E.VALUE);
        if (v === null || v === undefined) v = 0;
        if (typeof v === 'number' && !isFinite(v)) v = err(E.NUM);
      } catch (e) {
        v = isErr(e) ? e : err(E.VALUE);
      } finally {
        cell.computing = false;
      }
      cell.cache = v;
      cell.calcId = this.calcId;
      return v;
    }

    resolveSheet(name, ctx) {
      if (!name) return ctx.si;
      const i = this.sheetIndex(name);
      if (i < 0) throw err(E.REF);
      return i;
    }

    rangeValues(n, ctx) {
      const si = this.resolveSheet(n.sheet, ctx);
      let { r1, c1, r2, c2 } = n;
      if (r2 === Infinity || c2 === Infinity) {
        const ext = this.sheets[si].extent();
        if (r2 === Infinity) r2 = Math.max(r1, ext.rows - 1);
        if (c2 === Infinity) c2 = Math.max(c1, ext.cols - 1);
      }
      const [ra, rb] = [Math.min(r1, r2), Math.max(r1, r2)];
      const [ca, cb] = [Math.min(c1, c2), Math.max(c1, c2)];
      const rows = [];
      for (let r = ra; r <= rb; r++) {
        const row = [];
        for (let c = ca; c <= cb; c++) row.push(this.getValue(si, r, c));
        rows.push(row);
      }
      return new RangeVal(rows, ra, ca);
    }

    evaluate(n, ctx) {
      switch (n.k) {
        case 'num': case 'str': case 'bool': return n.v;
        case 'err': return err(n.v);
        case 'missing': return null;
        case 'name': throw err(E.NAME);
        case 'ref': return this.getValue(this.resolveSheet(n.sheet, ctx), n.r, n.c);
        case 'range': return this.rangeValues(n, ctx);
        case 'un': { const x = toNum(scalar(this.evaluate(n.x, ctx))); return n.op === '-' ? -x : x; }
        case 'pct': return toNum(scalar(this.evaluate(n.x, ctx))) / 100;
        case 'bin': return this.binary(n, ctx);
        case 'fn': return this.call(n, ctx);
        default: throw err(E.VALUE);
      }
    }

    binary(n, ctx) {
      const l = scalar(this.evaluate(n.l, ctx));
      const r = scalar(this.evaluate(n.r, ctx));
      if (isErr(l)) throw l;
      if (isErr(r)) throw r;
      switch (n.op) {
        case '+': return toNum(l) + toNum(r);
        case '-': return toNum(l) - toNum(r);
        case '*': return toNum(l) * toNum(r);
        case '/': { const d = toNum(r); if (d === 0) throw err(E.DIV0); return toNum(l) / d; }
        case '^': return Math.pow(toNum(l), toNum(r));
        case '&': return toStr(l) + toStr(r);
        case '=': return compare(l, r) === 0;
        case '<>': return compare(l, r) !== 0;
        case '<': return compare(l, r) < 0;
        case '>': return compare(l, r) > 0;
        case '<=': return compare(l, r) <= 0;
        case '>=': return compare(l, r) >= 0;
        default: throw err(E.VALUE);
      }
    }

    call(n, ctx) {
      const name = n.name;
      const ev = (a) => this.evaluate(a, ctx);
      const args = n.args;
      switch (name) {
        case 'IF': {
          const test = scalar(ev(args[0]));
          if (toBool(test)) return args.length > 1 ? ev(args[1]) : true;
          return args.length > 2 ? ev(args[2]) : false;
        }
        case 'IFS':
          for (let i = 0; i + 1 < args.length; i += 2) if (toBool(scalar(ev(args[i])))) return ev(args[i + 1]);
          throw err(E.NA);
        case 'IFERROR': case 'IFNA': {
          let v;
          try { v = scalar(ev(args[0])); } catch (e) { if (!isErr(e)) throw e; v = e; }
          if (isErr(v) && (name === 'IFERROR' || v.code === E.NA)) return ev(args[1]);
          return v;
        }
        case 'SWITCH': {
          const v = scalar(ev(args[0]));
          let i = 1;
          for (; i + 1 < args.length; i += 2) if (compare(v, scalar(ev(args[i]))) === 0) return ev(args[i + 1]);
          if (i < args.length) return ev(args[i]);
          throw err(E.NA);
        }
        case 'CHOOSE': {
          const i = Math.floor(toNum(scalar(ev(args[0]))));
          if (i < 1 || i >= args.length) throw err(E.VALUE);
          return ev(args[i]);
        }
        case 'ROW': case 'COLUMN': {
          const a = args[0];
          if (!a || a.k === 'missing') return (name === 'ROW' ? ctx.r : ctx.c) + 1;
          if (a.k === 'ref') return (name === 'ROW' ? a.r : a.c) + 1;
          if (a.k === 'range') return (name === 'ROW' ? a.r1 : a.c1) + 1;
          throw err(E.VALUE);
        }
        default: break;
      }
      const f = F[name];
      if (!f || !f.fn) throw err(E.NAME);
      const vals = args.map((a) => {
        if (a.k === 'missing') return undefined;
        try { return ev(a); } catch (e) { if (isErr(e)) return e; throw e; }
      });
      if (!ERROR_TOLERANT.has(name)) for (const v of vals) if (isErr(v)) throw v;
      return f.fn(vals, ctx);
    }

    // ------------------------------------------------ structural edits
    // Insert (count > 0) or delete (count < 0) rows/columns at index `at` in sheet si, fixing references everywhere.
    shift(si, axis, at, count) {
      const sh = this.sheets[si];
      const moved = new Map();
      for (const [k, cell] of sh.cells) {
        let [r, c] = k.split(',').map(Number);
        const v = axis === 'row' ? r : c;
        if (count < 0 && v >= at && v < at - count) continue;
        const nv = v >= at ? v + count : v;
        if (axis === 'row') r = nv; else c = nv;
        moved.set(key(r, c), cell);
      }
      sh.cells = moved;
      for (const prop of axis === 'row' ? ['rowHeights', 'hiddenRows'] : ['colWidths', 'hiddenCols']) {
        const moved2 = {};
        for (const [i, w] of Object.entries(sh[prop])) {
          const n = +i;
          if (count < 0 && n >= at && n < at - count) continue;
          moved2[n >= at ? n + count : n] = w;
        }
        sh[prop] = moved2;
      }
      // Merged ranges move with the rows/columns, grow when rows/columns are inserted inside them and shrink on delete.
      const [lo, hi] = axis === 'row' ? ['r1', 'r2'] : ['c1', 'c2'];
      sh.merges = sh.merges.map((m) => {
        const n = { ...m };
        if (count > 0) { if (n[lo] >= at) n[lo] += count; if (n[hi] >= at) n[hi] += count; }
        else {
          const end = at - count;
          n[lo] = n[lo] < at ? n[lo] : n[lo] >= end ? n[lo] + count : at;
          n[hi] = n[hi] < at ? n[hi] : n[hi] >= end ? n[hi] + count : at - 1;
        }
        return n;
      }).filter((m) => m.r2 >= m.r1 && m.c2 >= m.c1 && (m.r2 > m.r1 || m.c2 > m.c1));

      const prop = axis === 'row' ? 'r' : 'c';
      const thisName = sh.name.toLowerCase();
      for (const other of this.sheets) {
        for (const cell of other.cells.values()) {
          if (!cell.formula) continue;
          const next = rewriteRefs(cell.input, (p, isEnd, sheet, isRange) => {
            const target = sheet ? sheet.toLowerCase() : other.name.toLowerCase();
            if (target !== thisName || p[prop] === undefined) return p;
            const v = p[prop];
            if (count > 0) { if (v >= at) p[prop] = v + count; return p; }
            const end = at - count;
            if (v < at) return p;
            if (v >= end) { p[prop] = v + count; return p; }
            // Reference falls inside the deleted block.
            if (!isRange) return null;
            if (isEnd) { p[prop] = at - 1; return p[prop] < 0 ? null : p; }
            p[prop] = at;
            return p;
          });
          if (next !== cell.input) this.setCellInput(cell, next);
        }
      }
      this.recalc();
    }

    toJSON() {
      return {
        sheets: this.sheets.map((s) => ({
          name: s.name,
          colWidths: s.colWidths,
          rowHeights: s.rowHeights,
          view: s.view,
          cells: [...s.cells].map(([k, cell]) => [k, cell.input, cell.style || null]),
          ...(s.merges.length ? { merges: s.merges } : {}),
          ...(Object.keys(s.hiddenRows).length ? { hiddenRows: s.hiddenRows } : {}),
          ...(Object.keys(s.hiddenCols).length ? { hiddenCols: s.hiddenCols } : {}),
          ...(s.hidden ? { hidden: true } : {}),
          ...(s.tabColor ? { tabColor: s.tabColor } : {}),
          ...(s.defaultColWidth ? { defaultColWidth: s.defaultColWidth } : {}),
        })),
        ...(this.cellStyles.length ? { cellStyles: this.cellStyles } : {}),
      };
    }
    static fromJSON(data) {
      const wb = new Workbook();
      for (const s of data.sheets) {
        const sh = wb.addSheet(s.name);
        sh.colWidths = s.colWidths || {};
        sh.rowHeights = s.rowHeights || {};
        sh.view = s.view || {};
        sh.merges = s.merges || [];
        sh.hiddenRows = s.hiddenRows || {};
        sh.hiddenCols = s.hiddenCols || {};
        sh.hidden = !!s.hidden;
        sh.tabColor = s.tabColor || null;
        sh.defaultColWidth = s.defaultColWidth || null;
        for (const [k, input, style] of s.cells) {
          const cell = { input: '' };
          wb.setCellInput(cell, input);
          if (style) cell.style = style;
          sh.cells.set(k, cell);
        }
      }
      wb.cellStyles = data.cellStyles || [];
      if (!wb.sheets.length) wb.addSheet();
      wb.recalc();
      return wb;
    }
  }

  const api = {
    XLError, E, RangeVal, Workbook, Sheet, SyntaxErr,
    colName, colIndex, addr, parseAddr, parseRangeAddr,
    tokenize, parse, shiftFormula, rewriteRefs,
    parseLiteral, formatValue, formatColor, formatGeneral, formatPattern, formatCode,
    dateToSerial, serialToDate, isErr,
    FUNCTIONS: F,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XL = api;
})(typeof window !== 'undefined' ? window : globalThis);
