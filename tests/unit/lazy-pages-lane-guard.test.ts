/**
 * No lane selects a manifest-only book (#7343 lazy pages) for work over its pages
 * unless it materializes it first through the one materializer.
 *
 * PRIOR ART: tests/unit/page-counter-writers.test.ts is the same kind of source
 * scan for counter writers; it knows nothing of `pages_state`.
 *
 * The lanes below were each found, in the #7343 audit, to select a book by
 * `pages_count > 0` or by status and then read its pages: with no page docs they
 * either burned a slot every run, parked the book, or wrote a status that claimed
 * work it had not done (Phase 2's "0 pages left → ocr_complete"). Each must now
 * carry PAGES_MATERIALIZED_FILTER in its selector, or materialize via ensurePages.
 * A new archive lane that selects by `pages_archived < pages_count` belongs here.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** Uses of the filter in code, not in the import line or a comment. */
const filterUses = (src: string) => src.split('\n')
  .filter(l => l.includes('PAGES_MATERIALIZED_FILTER') && !/^\s*(import|\/\/|\*)/.test(l)).length;

/** file → how many selectors in it must spread PAGES_MATERIALIZED_FILTER. */
const SWEEPS: Record<string, number> = {
  'scripts/workers/archive-bulk.mjs': 1,
  'scripts/workers/archive-ocr.mjs': 1, // NEEDS_ARCHIVE_EXPR, spread into both of its queries
  'scripts/workers/archive-gallica.mjs': 1,
  'scripts/workers/archive-harvard.mjs': 1,
  'scripts/workers/archive-iiif-local.mjs': 2,
  'scripts/workers/archive-erara.mjs': 1,
  'scripts/catalog-coverage/archive-acquired.ts': 1,
  // Phase 0 enrol (window + convergence tail) and Phase 1 queued → archiving.
  'scripts/workers/pipeline-orchestrator.mjs': 3,
};

describe('lazy pages: lane selectors (#7343)', () => {
  for (const [file, n] of Object.entries(SWEEPS)) {
    it(`${file} keeps manifest-only books out of ${n} selector(s)`, () => {
      expect(filterUses(read(file))).toBeGreaterThanOrEqual(n);
    });
  }

  it('the orchestrator never reads "no pages to OCR" as done for a lazy book', () => {
    const src = read('scripts/workers/pipeline-orchestrator.mjs');
    const i = src.indexOf('if (pages.length === 0) {');
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, src.indexOf('alreadyDone: true', i));
    expect(block).toContain('LAZY_PAGES_FILTER');
    expect(block).toContain('skippedDuplicate: true');
  });

  it('every explicit trigger materializes through ensurePages', () => {
    for (const file of [
      'scripts/lib/pipeline-hold.mjs', // release = OCR dispatch
      'scripts/lib/publication.mjs',
      'src/lib/publication.ts',
      'scripts/workers/pipeline-orchestrator.mjs', // --book enrol
      'scripts/catalog-coverage/archive-acquired.ts', // --book
      'src/app/api/books/[id]/archive-images/route.ts',
    ]) {
      expect(read(file), file).toMatch(/ensurePages\(db, /);
    }
    expect(read('src/lib/lazy-pages.ts')).toMatch(/materializePages\(db, bookId, \{ trigger: 'reader'/);
  });

  it('only the materializer inserts a lazy book\'s pages (deterministic ids)', () => {
    const src = read('scripts/lib/lazy-pages.mjs');
    expect(src).toContain('pageIdFor(bookId, pageNumber)');
    expect(src).toContain("insertMany(docs, { ordered: false })");
  });
});
