/**
 * Only `page-counts` writes a book page counter (#5325, `.claude/docs/page-counts.md`).
 *
 * The six counters — pages_count, pages_ocr, pages_translated, pages_translatable,
 * pages_blank, pages_archived — have one writer: `recountBook()` in
 * `scripts/lib/page-counts.mjs` and its twin `src/lib/page-counts.ts`, which `$set`
 * all six together from one aggregation. Every other file that writes one is in
 * `tests/fixtures/page-counter-writers-baseline.json`, and that list may shrink and
 * must not grow. Burning it down is #5327 (live writers), #5328 (creation), #5329
 * (one-off scripts); the reconciler leaves it in #5326.
 *
 * WHY THE RULE CHANGED. The first version of this guard (#4442, 2026-08-31) asked only
 * that a writer IMPORT the module. That caught the three private pipelines of that
 * day, but an importing file could still write any subset it liked, and 29 did: on
 * 2026-09-30 two definitions of `pages_ocr` and `pages_blank` were alternating on live
 * books every two hours. It also looked at four of the six counters and at inline
 * `$set` only, so it could not see `$inc` (the orchestrator) or a hoisted update
 * object (four archive workers, `archive-images/route.ts`). All three are seen now.
 *
 * ADDING A WRITER: don't. Call `recountBook(db, bookId, { reason })` after your page
 * writes. A new book declares `initialPageCounters(n)` at insert (#5328).
 *
 * WHAT IT SEES (shapes, each with a negative control recorded in the #5325 PR):
 *   1. an inline update object — `$set` / `$setOnInsert` / `$inc: { pages_ocr: … }`
 *   2. a hoisted one — `$set: update` or `{ $set }` or `$set: { ...update }`, where
 *      `update` is declared as an object literal naming a counter, or is assigned
 *      one later (`update.pages_archived = n`, `update['pages_archived'] = n`)
 * WHAT IT DOES NOT SEE: inserts (book creation, #5328), and a counter key built at
 * run time. Scratch, archived and migration scripts are not live writers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const COUNTERS = [
  'pages_count', 'pages_ocr', 'pages_translated', 'pages_translatable', 'pages_blank', 'pages_archived',
];

/** The only files allowed to write a counter. */
const WRITERS = new Set(['scripts/lib/page-counts.mjs', 'src/lib/page-counts.ts']);

/** Scratch, archived and one-off migration scripts are not live writers. */
const SKIP_PATH = /node_modules|\.next|\.claude|_archived|\/_tmp|\/tmp-|scripts\/migration\//;

const BASELINE: string[] = JSON.parse(
  readFileSync('tests/fixtures/page-counter-writers-baseline.json', 'utf8'),
).files;

/** Current size of the baseline. Lower it when a file leaves; never raise it. */
const BASELINE_CEILING = 68;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (SKIP_PATH.test(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(mjs|ts|tsx|js)$/.test(p)) out.push(p);
  }
  return out;
}

/** Read a balanced `{ … }` starting at `open`, skipping string and template literals. */
function readBraces(src: string, open: number): string | null {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '`') {
      i++;
      while (i < src.length && src[i] !== '`') { if (src[i] === '\\') { i += 2; continue; } i++; }
      continue;
    }
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) return src.slice(open + 1, i); }
  }
  return null;
}

/** Counter keys named in an object-literal body (`pages_ocr:` or `'pages_ocr':`). */
function countersIn(body: string): string[] {
  return COUNTERS.filter(c => new RegExp(`(^|[^\\w.$])['"]?${c}['"]?\\s*:`).test(body));
}

const ESC = (s: string) => s.replace(/[$]/g, '\\$');
const UPDATE_OP = /(?<![\w$])\$(?:set|setOnInsert|inc)\b/g;

/**
 * Which counters a file writes, and in which shapes. Exported for the negative
 * controls, which feed it a violating source string.
 */
function scanSource(src: string): { counters: string[]; shapes: string[] } {
  const counters = new Set<string>();
  const shapes = new Set<string>();
  const hoisted = new Set<string>();

  let m: RegExpExecArray | null;
  UPDATE_OP.lastIndex = 0;
  while ((m = UPDATE_OP.exec(src))) {
    const op = m[0];
    const rest = src.slice(m.index + op.length);
    // `$set: { … }` — inline, plus any `...ident` spread inside it
    const inline = /^\s*:\s*\{/.exec(rest);
    if (inline) {
      const body = readBraces(src, m.index + op.length + inline[0].length - 1);
      if (!body) continue;
      const hit = countersIn(body);
      if (hit.length) {
        hit.forEach(c => counters.add(c));
        shapes.add(op === '$inc' ? '$inc' : 'inline');
      }
      for (const s of body.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) hoisted.add(s[1]);
      continue;
    }
    // `$set: update`
    const ident = /^\s*:\s*([A-Za-z_$][\w$]*)/.exec(rest);
    if (ident) { hoisted.add(ident[1]); continue; }
    // `{ $set }` / `{ $set, … }` — shorthand for a variable named `$set`
    if (/^\s*[,}]/.test(rest) && /[{,]\s*$/.test(src.slice(Math.max(0, m.index - 40), m.index))) hoisted.add(op);
  }

  for (const name of hoisted) {
    const n = ESC(name);
    const decl = new RegExp(`(?:const|let|var)\\s+${n}\\s*(?::[^=]+)?=\\s*\\{`, 'g');
    while ((m = decl.exec(src))) {
      const body = readBraces(src, m.index + m[0].length - 1);
      const hit = body ? countersIn(body) : [];
      if (hit.length) { hit.forEach(c => counters.add(c)); shapes.add('hoisted'); }
    }
    for (const c of COUNTERS) {
      if (new RegExp(`(?<![\\w$])${n}\\s*(?:\\.${c}|\\[\\s*['"]${c}['"]\\s*\\])\\s*=(?!=)`).test(src)) {
        counters.add(c); shapes.add('hoisted');
      }
    }
  }
  return { counters: [...counters], shapes: [...shapes] };
}

function counterWriters(): { file: string; counters: string[]; shapes: string[] }[] {
  const rows: { file: string; counters: string[]; shapes: string[] }[] = [];
  for (const file of [...walk('scripts'), ...walk('src')]) {
    if (WRITERS.has(file)) continue;
    const src = readFileSync(file, 'utf8');
    if (!/['"]books['"]/.test(src)) continue;
    const { counters, shapes } = scanSource(src);
    if (counters.length) rows.push({ file, counters, shapes });
  }
  return rows;
}

describe('book page-counter writers (#5325)', () => {
  const rows = counterWriters();

  it('no file outside page-counts writes a counter, except the baseline', () => {
    const known = new Set(BASELINE);
    const novel = rows
      .filter(r => !known.has(r.file))
      .map(r => `${r.file} (writes ${r.counters.join(', ')} via ${r.shapes.join(', ')})`);

    expect(novel, [
      'NEW files write book page counters outside recountBook().',
      'Every private writer writes its own subset, and on 2026-09-30 two definitions of',
      'pages_ocr and pages_blank were alternating on live books. Call',
      'recountBook(db, bookId, { reason }) from page-counts after your page writes.',
      '',
      ...novel,
    ].join('\n')).toEqual([]);
  });

  it('the baseline shrinks or holds — never grows', () => {
    // A file that stopped writing must leave the baseline in the same commit, so the
    // list stays a true inventory rather than a list of permissions.
    const live = new Set(rows.map(r => r.file));
    const stale = BASELINE.filter(f => !live.has(f));
    expect(stale, 'these no longer write a counter — remove them from the baseline and lower BASELINE_CEILING').toEqual([]);
    expect(BASELINE.length).toBeLessThanOrEqual(BASELINE_CEILING);
    expect(new Set(BASELINE).size).toBe(BASELINE.length);
  });

  it('finds writers in every shape (guards against a matcher that silently matches nothing)', () => {
    // Without this, a broken matcher passes the first test vacuously — the exact
    // failure that let 29 subset-writers exist under a green suite.
    expect(rows.length).toBeGreaterThan(40);
    const shapes = new Set(rows.flatMap(r => r.shapes));
    expect([...shapes].sort()).toEqual(['$inc', 'hoisted', 'inline']);
    const counters = new Set(rows.flatMap(r => r.counters));
    expect([...counters].sort()).toEqual([...COUNTERS].sort());
  });

  describe('negative controls: one violating source per shape is caught', () => {
    it('inline $set', () => {
      expect(scanSource(`await db.collection('books').updateOne({ id }, { $set: { pages_ocr: n, updated_at: new Date() } });`))
        .toEqual({ counters: ['pages_ocr'], shapes: ['inline'] });
    });
    it('$inc', () => {
      expect(scanSource(`books.updateOne({ id }, { $inc: { pages_count: -1 } });`))
        .toEqual({ counters: ['pages_count'], shapes: ['$inc'] });
    });
    it('hoisted update object, by name, by shorthand, by spread and by assignment', () => {
      expect(scanSource(`const update = { pages_archived: done, archive_status: 'ok' };\nawait books.updateOne({ id }, { $set: update });`))
        .toEqual({ counters: ['pages_archived'], shapes: ['hoisted'] });
      expect(scanSource(`const $set = { 'pages_blank': b };\nawait books.updateOne({ id }, { $set });`))
        .toEqual({ counters: ['pages_blank'], shapes: ['hoisted'] });
      expect(scanSource(`const counts = { pages_translated: t };\nawait books.updateOne({ id }, { $set: { ...counts, x: 1 } });`))
        .toEqual({ counters: ['pages_translated'], shapes: ['hoisted'] });
      expect(scanSource(`const upd = {};\nif (ok) upd.pages_translatable = n;\nawait books.updateOne({ id }, { $set: upd });`))
        .toEqual({ counters: ['pages_translatable'], shapes: ['hoisted'] });
    });
    it('does not flag reads: a projection, a query filter, a sort', () => {
      expect(scanSource(`books.find({ pages_count: { $gt: 0 } }).project({ pages_ocr: 1 }).sort({ pages_translated: -1 });`))
        .toEqual({ counters: [], shapes: [] });
    });
  });
});
