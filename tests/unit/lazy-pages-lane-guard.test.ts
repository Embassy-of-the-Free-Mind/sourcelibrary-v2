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

/**
 * The object literal that opens at the first `{` of the first match of `anchor`,
 * up to its balanced closing brace (quoted strings skipped). Throws when the
 * anchor is gone, so a rename fails loudly instead of passing vacuously.
 */
function selectorAt(src: string, anchor: RegExp): string {
  const m = anchor.exec(src);
  if (!m) throw new Error(`selector anchor not found: ${anchor}`);
  const open = m.index + m[0].indexOf('{');
  if (open < m.index) throw new Error(`anchor has no '{': ${anchor}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced selector at ${anchor}`);
}

/** True when the selector spreads the filter in code (a comment naming it does not count). */
const spreadsFilter = (selector: string, name = 'PAGES_MATERIALIZED_FILTER') =>
  selector.split('\n').some(l => !/^\s*(\/\/|\*)/.test(l) && l.includes(name));

/** file → the anchor of every selector in it that must carry PAGES_MATERIALIZED_FILTER. */
const SWEEPS: Record<string, RegExp[]> = {
  'scripts/workers/archive-bulk.mjs': [/: \{ \$match: \{/],
  'scripts/workers/archive-gallica.mjs': [/gallicaBooks = await db\.collection\('books'\)\s*\.find\(\{/],
  'scripts/workers/archive-harvard.mjs': [/harvardBooks = await db\.collection\('books'\)\s*\.find\(\{/],
  'scripts/workers/archive-iiif-local.mjs': [
    /: ANY_STATUS\s*\?\s*\{/,
    /:\s*\{\s*'pipeline_auto\.status': 'archiving'/,
  ],
  'scripts/workers/archive-erara.mjs': [/const eraraFilter = \{/],
  // Phase 0 enrol (window + convergence tail) and Phase 1 queued → archiving.
  'scripts/workers/pipeline-orchestrator.mjs': [
    /let newBooks = await db\.collection\('books'\)\s*\.find\(\{/,
    /const strays = await db\.collection\('books'\)\s*\.find\(\{/,
    /\{ \$match: \{ 'pipeline_auto\.status': 'queued'/,
  ],
  // #7346 review 4: a paid GPU lane that sorts smallest-first, and two archivers.
  'scripts/workers/mineru-ocr-worker.mjs': [/candidates = await books\.find\(\{\s*language: \/english\/i/],
  'scripts/workers/archive-eap.mjs': [
    /\? \{ 'image_source\.provider': 'bl'/,
    /: \{ tenantId: BHUTAN_TENANT_ID/,
  ],
  'scripts/workers/archive-chinese-philosophy.mjs': [/const q = \{ work_id:/],
};

describe('lazy pages: lane selectors (#7343)', () => {
  it('selectorAt reads the selector, not the file', () => {
    const src = "const a = { x: 1, y: { z: '}' } };\n// PAGES_MATERIALIZED_FILTER\nconst b = { ...PAGES_MATERIALIZED_FILTER };";
    expect(selectorAt(src, /const a = \{/)).toBe("{ x: 1, y: { z: '}' } }");
    expect(spreadsFilter(selectorAt(src, /const a = \{/))).toBe(false);
    expect(spreadsFilter(selectorAt(src, /const b = \{/))).toBe(true);
    expect(() => selectorAt(src, /const gone = \{/)).toThrow(/not found/);
  });

  for (const [file, anchors] of Object.entries(SWEEPS)) {
    anchors.forEach((anchor, i) => {
      it(`${file} selector ${i + 1}/${anchors.length} keeps manifest-only books out`, () => {
        expect(spreadsFilter(selectorAt(read(file), anchor)), String(anchor)).toBe(true);
      });
    });
  }

  it('scripts/workers/archive-ocr.mjs: both queries spread NEEDS_ARCHIVE_EXPR, which carries the filter', () => {
    const src = read('scripts/workers/archive-ocr.mjs');
    expect(spreadsFilter(selectorAt(src, /const NEEDS_ARCHIVE_EXPR = \{/))).toBe(true);
    for (const anchor of [
      /const priorityBooks = await db\.collection\('books'\)\s*\.find\(\s*\{/,
      /const otherBooks = remainingSlots > 0 \? await db\.collection\('books'\)\s*\.find\(\s*\{/,
    ]) {
      expect(spreadsFilter(selectorAt(src, anchor), '...NEEDS_ARCHIVE_EXPR'), String(anchor)).toBe(true);
    }
  });

  it('archive-acquired.ts selects manifest-only books ONLY to archive them from the manifest (#5448)', () => {
    const src = read('scripts/catalog-coverage/archive-acquired.ts');
    // Its book-mode selector admits lazy books on purpose (no PAGES_MATERIALIZED_FILTER) …
    expect(spreadsFilter(selectorAt(src, /const bookModeFilter: Record<string, unknown> = \{/))).toBe(false);
    // … so processBook must route every lazy book away from the page-doc path.
    const i = src.indexOf('if (isLazyPagesBook(b)) {');
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, src.indexOf('}', src.indexOf('else { lazySkipped++', i)) + 1);
    expect(block).toContain('ensurePages(db, w.book_id');
    expect(block).toContain('processLazyBook(w, b)');
    expect(block).toContain('lazySkipped++; return;');
    expect(src).toMatch(/archiveFromManifest\(db, w\.book_id, \{/);
  });

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
