/**
 * Every `src/` path that inserts a `books` record declares its page counters with
 * `initialPageCounters(n)` (#5328, `.claude/docs/page-counts.md` step 4).
 *
 * The creation routes set `pages_count` (and sometimes `pages_ocr`/`pages_translated`)
 * and never `pages_translatable`. That was one of the two sources of the 10,282 live
 * books without the field; the reconciler (#5326) was the other. A new book declares
 * all six at insert: `pages_count = pages_translatable = n`, the rest 0, because every
 * page is pending. The next `recountBook()` or the reconciler corrects it.
 *
 * WHAT IT SEES: a file under `src/` with `collection('books').insertOne(` or
 * `books.insertOne(` (same scan as book-creation-declares-content-type.test.ts).
 * WHAT IT DOES NOT SEE: a collection handle under another name, an upsert, and the
 * `scripts/` importers (pinned at the constructor: `makeBookDoc()` in
 * `book-docs.test.ts`). `books/restore` re-inserts an archived record verbatim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const INSERT = /collection\(['"]books['"]\)\s*\.insertOne\(|\bbooks\.insertOne\(/;
const EXEMPT = new Set(['src/app/api/books/restore/[id]/route.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

describe('book creation declares initialPageCounters(n)', () => {
  const creators = walk('src').filter((f) => !EXEMPT.has(f) && INSERT.test(readFileSync(f, 'utf8')));

  it('finds the creation paths (the scan is not vacuous)', () => {
    expect(creators.length).toBeGreaterThanOrEqual(14);
    expect(creators).toContain('src/app/api/import/ia/route.ts');
    expect(creators).toContain('src/lib/import-utils.ts');
  });

  it('each one spreads initialPageCounters() into the record it inserts', () => {
    const missing = creators.filter((f) => !/\.\.\.initialPageCounters\(/.test(readFileSync(f, 'utf8')));
    expect(missing).toEqual([]);
  });

  it('none hand-writes pages_count beside it (the spread is the only declaration)', () => {
    const handWritten = creators.filter((f) => {
      const src = readFileSync(f, 'utf8');
      const at = src.indexOf('...initialPageCounters(');
      // a literal counter key within the same object literal, a few lines either side
      const window = src.slice(Math.max(0, at - 400), at + 400);
      return /\bpages_(count|translatable|ocr|translated|blank|archived):\s*[\w.]/.test(window);
    });
    expect(handWritten).toEqual([]);
  });
});
