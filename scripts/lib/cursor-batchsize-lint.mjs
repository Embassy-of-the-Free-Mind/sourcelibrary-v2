#!/usr/bin/env node
// PRIOR ART: scripts/lib/imprint-write-lint.mjs — the same "static pass + pragma + baseline" shape, but it asks
// which `books` FIELDS a file writes; it has no notion of a cursor chain. tests/unit/bare-tag-strip-guard.test.ts
// is the substring-scan guard this is modelled on; a substring cannot tell `.find(` with a batchSize from one without.
/**
 * Long-running cursor loops in scripts/ must set an explicit batchSize. (#5859, #7268)
 *
 * mongodb driver v7 dropped the implicit getMore batchSize of 1000 (NODE-6296). Measured on prod `bookstore`:
 * with no batchSize a `books` projection cursor returns 101 then 45,718 docs per batch, a `pages` one 101 then
 * 196,055. The server kills a cursor after 10 minutes without a getMore, so a loop that does per-doc work
 * (an updateOne, an R2 fetch, a lookup) slower than ~3–13 ms/doc dies with CursorNotFound where it used to finish.
 * `.batchSize(1000)` is exactly the v6 behaviour.
 *
 * Shapes flagged — a `.find(` / `.aggregate(` call whose cursor is iterated document by document:
 *   inline    for await (const d of coll.find(q).project(p)) { … }
 *   variable  const cursor = coll.find(q);  …  for await (const d of cursor) / cursor.hasNext() / cursor.next()
 *   forEach   coll.find(q).forEach(d => …)  (or cursor.forEach on a variable as above)
 * Not flagged: a chain that already says `batchSize` (method or option), ends in `.toArray()`, or has a literal
 * `.limit(n)` with n ≤ 1000 (one getMore at most, as under v6). `.find(` whose first argument is a function is
 * Array.prototype.find, not a collection.
 *
 * A loop that is deliberately unbatched says so with a `cursor-batch-ok: <reason>` comment on the line of the
 * `.find(`/`.aggregate(` call or the line before it — visible in review, unlike a silent pass.
 *
 * STILL NOT SEEN: a cursor returned from another function, `.stream()` consumers, a reassigned `let`. It is a lint.
 *
 * CLI:  node scripts/lib/cursor-batchsize-lint.mjs            list findings under scripts/
 *       node scripts/lib/cursor-batchsize-lint.mjs --fix      insert `.batchSize(1000)` after each flagged call
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BATCH_SIZE = 1000;
export const PRAGMA_RE = /cursor-batch-ok:\s*\S/;
/** Directories under scripts/ that are not run any more (kept as provenance). */
export const SKIP_DIRS = new Set(['node_modules', 'vendor', '_archived', 'results']);

/** Index just past the bracket matching the one at `open`; skips strings, template literals and comments. */
export function matchClose(src, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [pairs[src[open]]];
  let i = open + 1;
  while (i < src.length && stack.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') i++;
        else if (c === '`' && src[i] === '$' && src[i + 1] === '{') { i = matchClose(src, i + 1); continue; }
        i++;
      }
      i++;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) stack.pop();
    i++;
  }
  return i;
}

/** Methods chained after the call that closes at `end`: [{ name, args, end }]. */
function chainAfter(src, end) {
  const out = [];
  const re = /^\s*\??\.\s*([\w$]+)\s*(?:<[^<>()]*>)?\s*\(/;
  let at = end;
  for (;;) {
    const m = re.exec(src.slice(at, at + 400));
    if (!m) break;
    const open = at + m[0].length - 1;
    const close = matchClose(src, open);
    out.push({ name: m[1], args: src.slice(open + 1, close - 1), end: close });
    at = close;
  }
  return out;
}

/** `src` with comments replaced by spaces (newlines kept, so indexes and line numbers still line up). */
export function blankComments(src) {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      const end = src[i + 1] === '/' ? (src.indexOf('\n', i) < 0 ? src.length : src.indexOf('\n', i))
        : (src.indexOf('*/', i + 2) < 0 ? src.length : src.indexOf('*/', i + 2) + 2);
      for (let k = i; k < end; k++) if (out[k] !== '\n') out[k] = ' ';
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < src.length && src[i] !== c && !(c !== '`' && src[i] === '\n')) { if (src[i] === '\\') i++; i++; }
    }
    i++;
  }
  return out.join('');
}

const CALL_RE =/\.\s*(find|aggregate)\s*(?:<[^<>()]*>)?\s*\(/g;
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Every `.find(…)` / `.aggregate(…)` call in `src`, with the chain that follows it. */
export function cursorCalls(src) {
  const calls = [];
  for (const m of src.matchAll(CALL_RE)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(src, open);
    const args = src.slice(open + 1, close - 1);
    // Array.prototype.find(fn) / a function argument: not a collection.
    if (/^\s*(?:async\s+)?(?:function\b|\(?[\w$,\s{}[\]]*\)?\s*=>)/.test(args)) continue;
    const chain = chainAfter(src, close);
    const end = chain.length ? chain[chain.length - 1].end : close;
    calls.push({ kind: m[1], start: m.index, close, args, chain, end, line: lineOf(src, m.index) });
  }
  return calls;
}

/** True when the call's own chain makes it safe without an added batchSize. */
function chainExempt(call) {
  if (/\bbatchSize\b/.test(call.args)) return true;
  for (const c of call.chain) {
    if (c.name === 'batchSize' || c.name === 'toArray') return true;
    if (c.name === 'limit') { const n = Number(c.args.trim()); if (Number.isFinite(n) && n > 0 && n <= BATCH_SIZE) return true; }
  }
  // aggregate: a literal { $limit: n } stage ≤ 1000 bounds the result the same way.
  if (call.kind === 'aggregate') {
    const lim = /\$limit\s*:\s*(\d+)/.exec(call.args);
    if (lim && Number(lim[1]) <= BATCH_SIZE) return true;
  }
  return false;
}

function pragmaAt(src, line) {
  const lines = src.split('\n');
  return PRAGMA_RE.test(lines[line - 1] || '') || PRAGMA_RE.test(lines[line - 2] || '');
}

/**
 * Findings for one source text: [{ line, kind: 'inline'|'variable'|'forEach', method, insertAt }].
 * `insertAt` is the index just past the `.find(…)`/`.aggregate(…)` call — where `.batchSize(1000)` goes.
 */
export function scanSource(original) {
  const src = blankComments(original);
  const calls = cursorCalls(src).filter(c => !chainExempt(c) && !pragmaAt(original, c.line));
  const findings = [];
  const seen = new Set();
  const add = (call, kind) => {
    if (seen.has(call.start)) return;
    seen.add(call.start);
    findings.push({ line: call.line, kind, method: call.kind, insertAt: call.close });
  };

  // forEach chained directly on the call.
  for (const c of calls) if (c.chain.some(x => x.name === 'forEach')) add(c, 'forEach');

  // inline: the call is the iterable of a `for await (… of …)` header.
  for (const m of src.matchAll(/for\s+await\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(src, open);
    for (const c of calls) if (c.start > open && c.end <= close) add(c, 'inline');
  }

  // variable: `[const|let|var] NAME = <expr whose value is the call>` whose NAME is iterated later.
  // The value may be one arm of a ternary (`LIMIT ? c.find(q).limit(LIMIT) : c.find(q)`).
  for (const m of src.matchAll(/(?:^|[;{}()\n]|\belse\b)[ \t]*(?:(?:const|let|var)\s+)?([\w$]+)\s*(?::\s*[^=;\n]+?)?\s*=(?![=>])/g)) {
    const name = m[1];
    if (/^(?:const|let|var|return|await|typeof)$/.test(name)) continue;
    const exprStart = m.index + m[0].length;
    const valueCalls = calls.filter(c => {
      if (c.start < exprStart || c.start >= exprStart + 600) return false;
      const pre = src.slice(exprStart, c.start);
      if (/;|(?<![=!<>])=(?![=>])|\n\s*(?:const|let|var|for|if|while|return)\b/.test(pre)) return false;
      // The chain must END the value (`wrap(coll.find(q))` ends in `)`: the cursor is an argument, not the value).
      return /^\s*(?:;|:|\n|$|\/\/)/.test(src.slice(c.end, c.end + 40));
    });
    if (!valueCalls.length) continue;
    const last = valueCalls[valueCalls.length - 1];
    // Usage window: until the next declaration of the same name.
    const n = name.replace(/\$/g, '\\$');
    const next = new RegExp(String.raw`\b(?:const|let|var)\s+${n}\b`, 'g');
    next.lastIndex = last.end;
    const nm = next.exec(src);
    const scope = src.slice(last.end, nm ? nm.index : src.length);
    if (new RegExp(String.raw`\b${n}\s*\.\s*batchSize\s*\(`).test(scope)) continue;
    if (new RegExp(String.raw`\b${n}\s*\.\s*toArray\s*\(`).test(scope)) continue;
    const iterated =
      new RegExp(String.raw`for\s+await\s*\([^)]*?\bof\s+${n}(?:\s+as\s+[\w$<>\[\]]+)?\s*\)`).test(scope) ||
      new RegExp(String.raw`\b${n}\s*\.\s*(?:hasNext|next|tryNext)\s*\(`).test(scope);
    const forEach = new RegExp(String.raw`\b${n}\s*\.\s*forEach\s*\(`).test(scope);
    for (const call of valueCalls) {
      if (iterated) add(call, 'variable');
      else if (forEach) add(call, 'forEach');
    }
  }
  return findings.sort((a, b) => a.insertAt - b.insertAt);
}

/** Insert `.batchSize(1000)` at every finding. Returns the new source. */
export function fixSource(src, findings = scanSource(src)) {
  let out = src;
  for (const f of [...findings].sort((a, b) => b.insertAt - a.insertAt)) {
    out = out.slice(0, f.insertAt) + `.batchSize(${BATCH_SIZE})` + out.slice(f.insertAt);
  }
  return out;
}

export function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|cjs|js|ts)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Findings across scripts/: [{ file (repo-relative, posix), line, kind, method }]. */
export function scanScripts(root) {
  const out = [];
  for (const f of walk(path.join(root, 'scripts'))) {
    const src = fs.readFileSync(f, 'utf8');
    if (!/\.(find|aggregate)\s*(<[^<>()]*>)?\s*\(/.test(src)) continue;
    const rel = path.relative(root, f).split(path.sep).join('/');
    for (const x of scanSource(src)) out.push({ file: rel, line: x.line, kind: x.kind, method: x.method });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const fix = process.argv.includes('--fix');
  const findings = scanScripts(root);
  if (fix) {
    for (const file of [...new Set(findings.map(f => f.file))]) {
      const p = path.join(root, file);
      fs.writeFileSync(p, fixSource(fs.readFileSync(p, 'utf8')));
    }
  }
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.kind}  .${f.method}()`);
  const files = new Set(findings.map(f => f.file)).size;
  console.log(`\n${findings.length} unbatched cursor loop(s) in ${files} file(s)${fix ? ' — fixed' : ''}`);
  process.exitCode = findings.length && !fix ? 1 : 0;
}
