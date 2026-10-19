/**
 * Every writer that archives or removes a page withdraws its vector (#6270).
 *
 * When a page is archived (`page_number <= 0`: a spread superseded by its halves, a deduped
 * leaf) or deleted from `pages` while its book stays, its `page_translations` row keeps its
 * vector and its OLD positive page_number. `match_semantic` serves it, and the link it builds
 * now points at a different page. On 2026-10-11 152,987 such rows were withdrawn in one window;
 * this test is what stops new ones. A writer must call `withdrawPageVectors()` from
 * `scripts/lib/withdraw-page-vectors.mjs` or its REST twin `src/lib/withdraw-page-vectors.ts`,
 * which park the vector in `embedding_withheld` (never a delete — the row holds translation text).
 *
 * WHAT IT SEES (file-level, each shape pinned by a negative control below):
 *   negate     an update that sets `page_number: -<expr>` (`-Math.abs(n)`, `-p.page_number`,
 *              `-origPn`, `-(10000 + i)`) — not the sort literal `page_number: -1`
 *   pipeline   an aggregation update `page_number: { $subtract: [-1, …] }` / `$multiply: [-1, …]`
 *   delete     `collection('pages').deleteOne/deleteMany(`, or the same on a variable bound to
 *              `collection('pages')`
 * WHAT IT DOES NOT SEE: a page number built elsewhere and assigned by name (`page_number: n`
 * with a negative n), and deletes inside a `bulkWrite` op list. Scratch, archived and migration
 * scripts are not live writers.
 *
 * EXEMPT is for files whose archive/delete cannot leave a served row behind, each with the
 * reason. It may shrink; a new entry needs a reason a reviewer can check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The helpers themselves. */
const HELPERS = new Set(['scripts/lib/withdraw-page-vectors.mjs', 'src/lib/withdraw-page-vectors.ts']);

const WHOLE_BOOK =
  'removes the whole book from `books`; page_translations is deliberately kept (it holds text) and ' +
  'the semantic read path drops rows whose book is gone (#4217, src/lib/prune-deleted-book.ts)';
const TWO_PHASE = 'two-phase renumber: the negative number is a placeholder and every page ends positive';

const EXEMPT: Record<string, string> = {
  'scripts/lib/delete-book.mjs': WHOLE_BOOK,
  'src/lib/delete-book.ts': WHOLE_BOOK,
  'scripts/maintenance/purge-artwork-duplicates.mjs': WHOLE_BOOK,
  'scripts/maintenance/remove-403-post1930.mjs': WHOLE_BOOK,
  'scripts/import-naj-sancai.mjs': WHOLE_BOOK + ' (the superseded NCL import)',
  'scripts/fix-scan-order.mjs': TWO_PHASE,
  'scripts/fix-scan-order-conservative.mjs': TWO_PHASE,
  'scripts/reorder-from-verified.mjs': TWO_PHASE,
  'scripts/import/import-oraec.mjs': 'rolls back a page inserted moments earlier in the same run, before any embed',
  'src/app/api/admin/fix-null-page-ids/route.ts': 'deletes pages with a null `id`, which no page_translations row can be keyed to',
  'scripts/audit/page-vector-truth.mjs': 'its positive control plants an archived page IN MEMORY; it writes nothing',
};

const SKIP_PATH = /node_modules|\.next|\.claude|_archived|\/_tmp|\/tmp-|scripts\/migration\/|\.test\.|__tests__/;

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

/** Block comments and whole-line `//` comments: prose about `page_number: -n` is not a write. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Which archive/remove shapes a source writes. Fed synthetic sources by the negative controls. */
function scanSource(raw: string): string[] {
  const src = stripComments(raw);
  const shapes = new Set<string>();
  // `page_number: -x` in an update — the sort/projection literal `-1` is not one.
  if (/page_number['"]?\s*:\s*-(?!\s*1\s*[,})\]])\s*[\w(]/.test(src)) shapes.add('negate');
  if (/page_number['"]?\s*:\s*\{\s*\$(?:subtract|multiply)\s*:\s*\[\s*-/.test(src)) shapes.add('pipeline');
  if (/collection\(\s*['"]pages['"]\s*\)\s*\.\s*delete(?:One|Many)\s*\(/.test(src)) shapes.add('delete');
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w$.]*collection\(\s*['"]pages['"]\s*\)\s*[;\n]/g)) {
    if (new RegExp(`(?<![\\w$.])${m[1].replace(/\$/g, '\\$')}\\s*\\.\\s*delete(?:One|Many)\\s*\\(`).test(src)) shapes.add('delete');
  }
  return [...shapes].sort();
}

// A call in code, not in a comment: a commented-out call is the regression this test exists for.
const CALLS = /\bwithdrawPageVectors\s*\(/;

function archivingWriters(): { file: string; shapes: string[]; calls: boolean }[] {
  const rows: { file: string; shapes: string[]; calls: boolean }[] = [];
  for (const file of [...walk('scripts'), ...walk('src')]) {
    if (HELPERS.has(file)) continue;
    const src = readFileSync(file, 'utf8');
    const shapes = scanSource(src);
    if (shapes.length) rows.push({ file, shapes, calls: CALLS.test(stripComments(src)) });
  }
  return rows;
}

describe('writers that archive or remove pages withdraw their vectors (#6270)', () => {
  const rows = archivingWriters();

  it('every file that archives or deletes pages calls withdrawPageVectors(), or is exempt with a reason', () => {
    const missing = rows
      .filter(r => !r.calls && !(r.file in EXEMPT))
      .map(r => `${r.file} (${r.shapes.join(', ')})`);
    expect(missing, [
      'These files archive (page_number <= 0) or delete pages but do not withdraw the pages\'',
      'page_translations vectors, so semantic search keeps serving them under a page number that',
      'now belongs to another page. After the Mongo write, call',
      "  withdrawPageVectors(pageIds, { reason: 'archived' | 'removed', writer })",
      'from scripts/lib/withdraw-page-vectors.mjs (or src/lib/withdraw-page-vectors.ts in a route).',
      '',
      ...missing,
    ].join('\n')).toEqual([]);
  });

  it('exemptions are live: each exempt file still archives or deletes, and none also calls the helper', () => {
    const byFile = new Map(rows.map(r => [r.file, r]));
    const stale = Object.keys(EXEMPT).filter(f => !byFile.has(f));
    expect(stale, 'no longer archives or deletes pages — remove from EXEMPT').toEqual([]);
    const both = Object.keys(EXEMPT).filter(f => byFile.get(f)?.calls);
    expect(both, 'calls withdrawPageVectors — remove from EXEMPT').toEqual([]);
  });

  it('finds writers in every shape (guards against a matcher that silently matches nothing)', () => {
    const callers = rows.filter(r => r.calls).map(r => r.file);
    expect(callers.length).toBeGreaterThanOrEqual(15);
    // The named writers of the issue: spread splitting, dedupe, the reset routes.
    for (const f of [
      'scripts/split-book.mjs', 'scripts/split-book-v2.mjs', 'scripts/split-pecha.mjs',
      'scripts/workers/lib/trailing-dedup.mjs', 'scripts/dedup-autoapply.mjs', 'scripts/dedup-apply-approved.mjs',
      'src/app/api/pages/[id]/route.ts', 'src/app/api/books/[id]/reimport/route.ts',
    ]) expect(callers, f).toContain(f);
    expect([...new Set(rows.flatMap(r => r.shapes))].sort()).toEqual(['delete', 'negate', 'pipeline']);
  });

  describe('negative controls: one violating source per shape is caught', () => {
    it('negate', () => {
      expect(scanSource(`await pages.updateOne({ _id }, { $set: { page_number: -Math.abs(p.page_number) } });`)).toEqual(['negate']);
      expect(scanSource(`ops.push({ $set: { page_number: -origPn, split_into } });`)).toEqual(['negate']);
      expect(scanSource(`{ $set: { page_number: -(10000 + i) } }`)).toEqual(['negate']);
    });
    it('pipeline', () => {
      expect(scanSource(`updateMany(f, [{ $set: { page_number: { $subtract: [-1, { $abs: '$page_number' }] } } }])`)).toEqual(['pipeline']);
    });
    it('delete, direct and through a variable', () => {
      expect(scanSource(`await db.collection('pages').deleteMany({ book_id });`)).toEqual(['delete']);
      expect(scanSource(`const Pages = db.collection('pages');\nawait Pages.deleteOne({ id });`)).toEqual(['delete']);
    });
    it('does not flag reads or prose: a descending sort, a filter on archived pages, a comment', () => {
      expect(scanSource(`/**\n * keeps the parent with \`page_number: -n\` and split_into\n */\n// db.collection('pages').deleteMany({})`)).toEqual([]);
      expect(scanSource(`pages.find({ page_number: { $lte: 0 } }).sort({ page_number: -1 });`)).toEqual([]);
      expect(scanSource(`.sort({ page_number: -1, _id: 1 })`)).toEqual([]);
    });
  });
});
