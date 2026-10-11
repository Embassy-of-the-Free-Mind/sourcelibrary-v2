/**
 * Which `$set` blocks in a source file are writes to `books`?
 *
 * PRIOR ART: scripts/audit/new-field-writes.mjs — this IS its attribution step,
 * moved out so a test can import it (the audit runs and exits on import, which
 * made its coverage untestable — tests-that-are-not-guards.md, the "copy a test
 * cannot import" paragraph). scripts/audit/raw-book-inserts.mjs looks at inserts,
 * not `$set`.
 *
 * Three ways a `$set` is attributed, each by WHICH HANDLE the write goes through,
 * never by "this file mentions books" (the file-wide sweep: 814 false positives):
 *
 *   inline  db.collection('books').updateOne(f, { $set: {…} })
 *           — within 900 chars after the collection call, no other collection between.
 *   handle  const books = db.collection('books');  …45 lines…  books.updateOne(f, { $set })
 *           — #4493. The hoisted handle is the dominant idiom in scripts/, and the
 *           window above never reached it. Any distance; the binding nearest above
 *           the call decides, so a `col` rebound to `pages` further down is `pages`.
 *   built   ops.push({ updateOne: { update: { $set } } }) … books.bulkWrite(ops)
 *           const update = { $set }; … books.updateOne(f, update)
 *           — one hop from the write call to where its argument was built.
 *
 * STILL NOT SEEN (say so rather than pass silently):
 *   - a handle that arrives as a function parameter under another name, on a class
 *     field (`this.books`), or by destructuring;
 *   - an update object built more than one hop away, or mutated after it is declared
 *     (`updates.foo = 1`) — a `$set: updates` whose literal is not found is returned
 *     in `opaque` so the audit can count it;
 *   - computed keys (`$set: { [name]: v }`), which the audit reports separately.
 */

const WINDOW = 900;
const WRITE_METHODS = 'updateOne|updateMany|findOneAndUpdate|bulkWrite';
const COLL = String.raw`collection(?:<[^>()]*>)?\(\s*`;
const BOOKS_CALL = new RegExp(COLL + String.raw`['"\`]books['"\`]\s*\)`, 'g');
const OTHER_CALL = new RegExp(COLL + String.raw`['"\`](?!books['"\`])`);
const SET_RE = /\$set(?:OnInsert)?\s*:\s*/g;
const IDENT = String.raw`[A-Za-z_$][\w$]*`;
const esc = (s) => s.replace(/[$]/g, '\\$&');

const CLOSER = { '(': ')', '{': '}', '[': ']' };

/**
 * Index of the bracket closing the one at `open`, skipping strings, templates,
 * comments and regex literals. -1 if unbalanced.
 */
export function matchBracket(src, open) {
  const o = src[open], c = CLOSER[o];
  let d = 0, prev = '';
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"') { i++; while (i < src.length && src[i] !== ch) { if (src[i] === '\\') i++; i++; } prev = ch; continue; }
    if (ch === '`') { i++; while (i < src.length && src[i] !== '`') { if (src[i] === '\\') i++; i++; } prev = ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (ch === '/' && (prev === '' || '(,=:[!&|?{};'.includes(prev))) {
      // A regex literal: quotes and brackets inside it are not code.
      let j = i + 1, cls = false;
      while (j < src.length && src[j] !== '\n' && (cls || src[j] !== '/')) {
        if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false;
        j++;
      }
      if (src[j] === '/') { i = j; prev = '/'; continue; }
    }
    if (ch === o) d++;
    else if (ch === c) { d--; if (!d) return i; }
    if (!/\s/.test(ch)) prev = ch;
  }
  return -1;
}

/** `X = …collection('name')` where the handle itself is what is kept (no `.find(` chained on). */
function bindings(src) {
  const out = [];
  const re = new RegExp(String.raw`(?:^|[^\w$.])(${IDENT})\s*(?::[^=;\n]+)?=\s*[^=;\n]*?\.?\b${COLL}`, 'gm');
  let m;
  while ((m = re.exec(src))) {
    const open = src.lastIndexOf('(', re.lastIndex);
    const close = matchBracket(src, open);
    if (close < 0) continue;
    if (/^\s*[.[(]/.test(src.slice(close + 1, close + 40))) continue; // chained: X holds a result, not the handle
    const lit = /^\s*(['"`])([^'"`$]+)\1\s*$/.exec(src.slice(open + 1, close));
    out.push({ name: m[1], coll: lit ? lit[2] : null, index: m.index });
  }
  return out;
}

/** Collection a handle name refers to at `pos`: the binding nearest above, else the only one in the file. */
function resolve(binds, name, pos) {
  const mine = binds.filter((b) => b.name === name);
  if (!mine.length) return undefined;
  const above = mine.filter((b) => b.index < pos);
  if (above.length) return above[above.length - 1].coll;
  return mine.every((b) => b.coll === mine[0].coll) ? mine[0].coll : null;
}

/** Top-level arguments of a call body that are bare identifiers. */
function bareArgs(body) {
  const args = []; let start = 0;
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i];
    if (ch === '(' || ch === '{' || ch === '[') { const e = matchBracket(body, i); if (e < 0) break; i = e; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { i++; while (i < body.length && body[i] !== ch) { if (body[i] === '\\') i++; i++; } continue; }
    if (ch === ',' || i === body.length) {
      const a = body.slice(start, i).trim();
      if (new RegExp(`^${IDENT}$`).test(a)) args.push(a);
      start = i + 1;
    }
  }
  return args;
}

/** The `{`/`[`/`(` that opens the initializer of the declaration of `name` nearest above `pos`. */
function declOpen(src, name, pos) {
  const re = new RegExp(String.raw`(?:const|let|var)\s+${esc(name)}\s*(?::[^=;\n]+)?=\s*`, 'g');
  let m, last = -1;
  while ((m = re.exec(src)) && m.index < pos) last = re.lastIndex;
  if (last < 0) return -1;
  const rest = /^[^;\n]*?([{[(])/.exec(src.slice(last, last + 300));
  return rest ? last + rest[0].length - 1 : -1;
}

/**
 * @returns {{ sets: Array<{index:number, body:string, via:'inline'|'handle'|'built'}>, opaque: number[] }}
 *   `sets`: every literal `$set`/`$setOnInsert` body attributed to `books`, by source offset.
 *   `opaque`: offsets of `$set: someVariable` in a books write whose literal was not found.
 */
export function booksSetBlocks(src) {
  const found = new Map();
  const opaque = new Set();

  const takeSet = (at, valueAt, via, hop = true) => {
    if (src[valueAt] === '{') {
      const end = matchBracket(src, valueAt);
      if (end > 0 && !found.has(at)) found.set(at, { index: at, body: src.slice(valueAt + 1, end), via });
      return;
    }
    const id = new RegExp(`^(${IDENT})\\s*[,}]`).exec(src.slice(valueAt, valueAt + 80));
    if (!id) return;
    const open = hop ? declOpen(src, id[1], at) : -1;
    if (open > 0 && src[open] === '{') {
      const end = matchBracket(src, open);
      if (end > 0 && !found.has(open)) found.set(open, { index: open, body: src.slice(open + 1, end), via: 'built' });
    } else opaque.add(at);
  };
  const scan = (from, to, via) => {
    SET_RE.lastIndex = from;
    let m;
    while ((m = SET_RE.exec(src)) && m.index < to) takeSet(m.index, SET_RE.lastIndex, via);
  };
  const scanBlockAt = (open, via) => {
    const end = open >= 0 ? matchBracket(src, open) : -1;
    if (end > 0) scan(open, end, via);
  };

  // inline — the original rule, unchanged in reach.
  BOOKS_CALL.lastIndex = 0;
  let cm;
  const inlineStarts = [];
  while ((cm = BOOKS_CALL.exec(src))) inlineStarts.push(cm.index);
  SET_RE.lastIndex = 0;
  let sm;
  while ((sm = SET_RE.exec(src))) {
    const at = sm.index, valueAt = SET_RE.lastIndex;
    const start = inlineStarts.find((a) => at > a && at < a + WINDOW);
    if (start === undefined) continue;
    if (OTHER_CALL.test(src.slice(start + 1, at))) continue;
    const keep = SET_RE.lastIndex;
    takeSet(at, valueAt, 'inline', false);
    SET_RE.lastIndex = keep;
  }

  // handle + built — follow the write call, wherever its handle was bound.
  const binds = bindings(src);
  const writeRe = new RegExp(String.raw`(?:(?:^|[^\w$.])(${IDENT})|(${COLL}['"\`]([^'"\`]+)['"\`]\s*\)))\s*\.\s*(${WRITE_METHODS})\s*\(`, 'gm');
  const calls = [];
  let wm;
  while ((wm = writeRe.exec(src))) {
    const open = writeRe.lastIndex - 1;
    const close = matchBracket(src, open);
    if (close < 0) continue;
    const coll = wm[1] ? resolve(binds, wm[1], wm.index) : wm[3];
    calls.push({ coll, method: wm[4], open, close, args: bareArgs(src.slice(open + 1, close)) });
  }
  for (const call of calls) {
    if (call.coll !== 'books') continue;
    scan(call.open, call.close, 'handle');
    for (const arg of call.args) {
      if (call.method !== 'bulkWrite') { const o = declOpen(src, arg, call.open); if (o > 0 && src[o] === '{') scanBlockAt(o, 'built'); continue; }
      // The ops array: its initializer and every push, each owned by the bulkWrite that flushes it.
      const sites = [];
      const d = declOpen(src, arg, call.open);
      if (d > 0) sites.push(d);
      const pushRe = new RegExp(String.raw`(?:^|[^\w$.])${esc(arg)}\s*\.\s*push\s*\(`, 'gm');
      while (pushRe.exec(src)) sites.push(pushRe.lastIndex - 1);
      const flushes = calls.filter((c) => c.method === 'bulkWrite' && c.args.includes(arg));
      for (const site of sites) {
        const owner = flushes.find((c) => c.open > site) || [...flushes].reverse().find((c) => c.open < site);
        if (owner === call) scanBlockAt(site, 'built');
      }
    }
  }

  const sets = [...found.values()].sort((a, b) => a.index - b.index);
  return { sets, opaque: [...opaque].filter((at) => !found.has(at)).sort((a, b) => a - b) };
}

/**
 * Top-level keys of an object-literal body. A key is a name or a quoted string
 * directly after the opening brace or a comma — `a ? b : c` and
 * `cond ? 'x:y' : 'z'` in a VALUE are not keys (they were read as fields named
 * `b` and `x:y` until #4493 widened the scan enough to trip on them).
 */
export function topKeys(body) {
  const keys = [];
  let prev = ',';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (/\s/.test(ch)) continue;
    if (ch === '/' && body[i + 1] === '/') { while (i < body.length && body[i] !== '\n') i++; continue; }
    if (ch === '/' && body[i + 1] === '*') { const e = body.indexOf('*/', i + 2); if (e < 0) break; i = e + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < body.length && body[j] !== ch) { if (body[j] === '\\') j++; j++; }
      if (prev === ',' && ch !== '`' && /^\s*:/.test(body.slice(j + 1))) keys.push(body.slice(i + 1, j));
      i = j; prev = ch; continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') { const e = matchBracket(body, i); if (e < 0) break; i = e; prev = ')'; continue; }
    if (prev === ',') {
      const m = new RegExp(`^(${IDENT})\\s*:`).exec(body.slice(i));
      if (m) { keys.push(m[1]); i += m[1].length - 1; prev = 'k'; continue; }
    }
    prev = ch;
  }
  return keys;
}
