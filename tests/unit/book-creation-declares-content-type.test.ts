/**
 * Every `src/` path that inserts a `books` record declares `content_type` (#5292c).
 *
 * PR #5453 stamped the field in `makeBookDoc()` (the script importers) and in
 * `import-utils.ts`, and backfilled 57,042 untyped paged records to zero. The
 * hand-built insert routes were left for later, and between 2026-10-08 and
 * 2026-10-12 they created 19,862 more untyped records (19,850 through
 * `/api/import/museumsofindia`). The reading rule in `src/lib/artwork-record.ts`
 * treats "no content_type, no resource_type" as a book, so nothing misrendered;
 * but the artwork exclusion in the translation ladder then rests on a coincidence
 * again. This is the check that keeps the list at zero.
 *
 * WHAT IT SEES: a file under `src/` with `collection('books').insertOne(` or
 * `books.insertOne(`. WHAT IT DOES NOT SEE: a collection handle under another
 * name, an upsert, and the `scripts/` importers (pinned at the constructor by
 * `book-docs.test.ts`). `books/restore` re-inserts an archived record verbatim
 * and must not restamp it.
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

describe('book creation declares content_type', () => {
  const creators = walk('src').filter((f) => !EXEMPT.has(f) && INSERT.test(readFileSync(f, 'utf8')));

  it('finds the creation paths (the scan is not vacuous)', () => {
    expect(creators.length).toBeGreaterThanOrEqual(14);
    expect(creators).toContain('src/app/api/import/museumsofindia/route.ts');
    expect(creators).toContain('src/lib/import-utils.ts');
  });

  it('each one sets content_type on the record it inserts', () => {
    const missing = creators.filter((f) => !/\bcontent_type:\s*['"]/.test(readFileSync(f, 'utf8')));
    expect(missing).toEqual([]);
  });
});
