/**
 * Entity → page attribution guards (issue #3361).
 *
 * The bug: the index extractor gets bare entity name lists back from Gemini for
 * a ~50k-char BATCH (no page numbers — only `quotes` carry a page), and the old
 * code credited every page in the batch's range with every entity in it.
 * `/encyclopedia/[name]` then rendered those inferred numbers as exact `p. N`
 * citations. Measured on live data, ~14-22% of claimed pages actually contained
 * the name.
 *
 * The invariant these tests pin is STRUCTURAL, not statistical: a page number is
 * only ever attributed to an entity if that page's text names the entity. When
 * nothing matches we fall back to section precision with NO page numbers — a
 * coarse true claim instead of a precise false one. Any change that lets
 * `pages` be populated without a text hit reintroduces fabricated citations.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  normalizeForMatch,
  buildEntityMatcher,
  pageMatchesEntity,
  buildPageTexts,
  attributeEntityPages,
  dedupeEntityBooks,
  entityCounters,
} from '../../scripts/lib/entity-page-match.mjs';
import {
  normalizeForMatch as normalizeTs,
  buildEntityMatcher as buildMatcherTs,
  pageMatchesEntity as pageMatchesTs,
  attributeEntityPages as attributeTs,
  buildPageTexts as buildPageTextsTs,
} from '../../src/lib/entity-page-match';
import {
  dedupeEntityBooks as dedupeTs,
  entityCounters as countersTs,
  normalizeEntityBook,
  type EntityBookRef,
} from '../../src/lib/entity-books';

const page = (page_number: number, ocr: string, translation = '') => ({
  page_number,
  ocr: { data: ocr },
  translation: { data: translation },
});

describe('normalizeForMatch', () => {
  it('folds diacritics, case, and Latin j/v so early-modern print matches', () => {
    expect(normalizeForMatch('Gérard')).toBe('gerard');
    expect(normalizeForMatch('Johannes')).toBe('iohannes');
    expect(normalizeForMatch('VRBS')).toBe('urbs');
    expect(normalizeForMatch('Jovis')).toBe('iouis');
  });
});

describe('buildEntityMatcher', () => {
  it('stems long names so Latin case endings still match', () => {
    const m = buildEntityMatcher('Matthiolus');
    expect(pageMatchesEntity(m, normalizeForMatch('cuius explanator est Matthioli'))).toBe(true);
    expect(pageMatchesEntity(m, normalizeForMatch('Matthiolum sequitur'))).toBe(true);
  });

  it('ignores honorifics — "Saint Perpetua" must not match every saint', () => {
    const m = buildEntityMatcher('Saint Perpetua');
    expect(pageMatchesEntity(m, normalizeForMatch('octaue of saint stephen'))).toBe(false);
    expect(pageMatchesEntity(m, normalizeForMatch('the passion of Perpetua'))).toBe(true);
  });

  it('requires a word boundary for short anchors (no smart/smartly)', () => {
    const m = buildEntityMatcher('James Smart');
    expect(pageMatchesEntity(m, normalizeForMatch('are smartly vibrated against the medium'))).toBe(false);
    expect(pageMatchesEntity(m, normalizeForMatch('as Smart observes'))).toBe(true);
  });

  it('does not fire on a near-miss stem of a different person', () => {
    // Live false positive: "Marcus Aurelius Antoninus" hit a page naming his
    // mother Aurelia, because every token was a needle and "aureli" is a prefix
    // of "aurelia". Only the distinctive token counts now.
    const m = buildEntityMatcher('Marcus Aurelius Antoninus');
    expect(pageMatchesEntity(m, normalizeForMatch('nato duno lucio cesare & di aurelia romani'))).toBe(false);
    expect(pageMatchesEntity(m, normalizeForMatch('Antonini imperatoris'))).toBe(true);
  });

  it('falls back to whole-name word match when no token is distinctive', () => {
    const m = buildEntityMatcher('Job');
    expect(pageMatchesEntity(m, normalizeForMatch('the book of Job'))).toBe(true);
    expect(pageMatchesEntity(m, normalizeForMatch('jobbing work'))).toBe(false);
  });
});

describe('attributeEntityPages', () => {
  const pages = buildPageTexts([
    page(47, 'de arte medica nihil'),
    page(48, 'cuius exactissimus explanator est Matthiolus'),
    page(49, 'sequitur Fuchsius'),
    page(50, 'Matthioli sententia de iunipero'),
  ]);

  it('attributes only the pages whose text names the entity', () => {
    const res = attributeEntityPages('Matthiolus', pages);
    expect(res.page_precision).toBe('page');
    expect(res.pages).toEqual([48, 50]);
  });

  it('NEVER returns page numbers it could not verify (the #3361 invariant)', () => {
    const res = attributeEntityPages('Paracelsus', pages);
    expect(res.page_precision).toBe('section');
    expect(res.pages).toEqual([]);
    expect(res.page_range).toEqual({ start: 47, end: 50 });
  });

  it('keeps a section range that spans the batch, not a fabricated page list', () => {
    const res = attributeEntityPages('Paracelsus', pages);
    // The old bug: pages would have been [47,48,49,50]. If this ever holds
    // again, encyclopedia pages are citing pages that do not mention the entity.
    expect(res.pages.length).toBe(0);
  });

  it('handles a batch with no usable page numbers', () => {
    const res = attributeEntityPages('Anyone', buildPageTexts([]));
    expect(res.page_precision).toBe('section');
    expect(res.pages).toEqual([]);
    expect(res.page_range).toBeUndefined();
  });

  it('reads both OCR and translation as evidence', () => {
    const p = buildPageTexts([page(5, 'lorem ipsum', 'Mattioli writes that juniper lasts a hundred years')]);
    // "Mattioli" (translation spelling) stems to the same needle as "Matthiolus".
    expect(attributeEntityPages('Mattioli', p).pages).toEqual([5]);
  });
});

describe('dedupeEntityBooks', () => {
  it('collapses repeat entries for one book and merges their pages', () => {
    // The writer used $addToSet on the whole subdocument, so a re-run appended a
    // second entry for the same book: Matthiolus carried 162 entries for 117
    // distinct books, which is why the hero count and the "Appears in N Books"
    // heading disagreed on the live page.
    const out = dedupeEntityBooks([
      { book_id: 'b1', book_title: 'T', pages: [4, 5], page_precision: 'page' },
      { book_id: 'b1', book_title: 'T', pages: [5, 9], page_precision: 'page' },
      { book_id: 'b2', book_title: 'U', pages: [], page_precision: 'section', page_range: { start: 1, end: 9 } },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].pages).toEqual([4, 5, 9]);
    expect(out[1].page_precision).toBe('section');
  });

  it('lets verified pages win over a section range for the same book', () => {
    const out = dedupeEntityBooks([
      { book_id: 'b1', pages: [], page_precision: 'section', page_range: { start: 1, end: 9 } },
      { book_id: 'b1', pages: [7], page_precision: 'page' },
    ]);
    expect(out[0].page_precision).toBe('page');
    expect(out[0].pages).toEqual([7]);
    expect(out[0].page_range).toBeUndefined();
  });

  it('drops entries with no book_id', () => {
    expect(dedupeEntityBooks([{ pages: [1] }, { book_id: 'b', pages: [2] }])).toHaveLength(1);
  });
});

describe('entityCounters', () => {
  it('counts distinct books and VERIFIED page references only', () => {
    const books = [
      { book_id: 'b1', pages: [4, 5], page_precision: 'page' },
      { book_id: 'b1', pages: [4, 5], page_precision: 'page' },
      { book_id: 'b2', pages: [], page_precision: 'section', page_range: { start: 1, end: 30 } },
    ];
    // Old behavior: book_count 3, total_mentions 4+2+30. Matthiolus advertised
    // "10,700 total mentions" this way.
    expect(entityCounters(books)).toEqual({ book_count: 2, total_mentions: 2 });
  });
});

describe('normalizeEntityBook (read-side legacy demotion)', () => {
  it('demotes an unmarked legacy entry to section precision', () => {
    // The 1M pre-existing entity rows carry no page_precision and a smeared
    // page array. Until the repair sweep reaches them the read path must not
    // render those numbers as citations — it keeps the span, drops the pages.
    const out = normalizeEntityBook({
      book_id: 'b1', book_title: 'T', book_author: 'A', pages: [47, 48, 49, 50],
    } as EntityBookRef);
    expect(out.page_precision).toBe('section');
    expect(out.pages).toEqual([]);
    expect(out.page_range).toEqual({ start: 47, end: 50 });
  });

  it('leaves an already-marked entry untouched', () => {
    const entry = {
      book_id: 'b1', book_title: 'T', book_author: 'A', pages: [48], page_precision: 'page',
    } as EntityBookRef;
    expect(normalizeEntityBook(entry)).toBe(entry);
  });

  it('handles a legacy entry with an empty page array', () => {
    const out = normalizeEntityBook({
      book_id: 'b1', book_title: 'T', book_author: 'A', pages: [],
    } as EntityBookRef);
    expect(out.page_precision).toBe('section');
    expect(out.page_range).toBeUndefined();
  });
});

describe('PARITY: scripts/lib/entity-page-match.mjs vs src/lib/entity-books.ts', () => {
  // The writer (.mjs) and the read path (.ts) must agree on dedupe and counting,
  // or the stored counters and the rendered list drift apart again.
  const FIXTURES: EntityBookRef[][] = [
    [],
    [{ book_id: 'b1', book_title: 'T', book_author: 'A', pages: [4, 5], page_precision: 'page' }],
    [
      { book_id: 'b1', book_title: 'T', book_author: 'A', pages: [4, 5], page_precision: 'page' },
      { book_id: 'b1', book_title: 'T', book_author: 'A', pages: [5, 9], page_precision: 'page' },
    ],
    [
      { book_id: 'b1', book_title: 'T', book_author: 'A', pages: [], page_precision: 'section', page_range: { start: 1, end: 9 } },
      { book_id: 'b1', book_title: 'T', book_author: 'A', pages: [7], page_precision: 'page' },
      { book_id: 'b2', book_title: 'U', book_author: 'B', pages: [], page_precision: 'section', page_range: { start: 3, end: 8 } },
    ],
  ];

  it.each(FIXTURES.map((f, i) => [i, f] as const))('fixture %i dedupes identically', (_i, fixture) => {
    expect(dedupeTs(fixture)).toEqual(dedupeEntityBooks(fixture));
  });

  it.each(FIXTURES.map((f, i) => [i, f] as const))('fixture %i counts identically', (_i, fixture) => {
    expect(countersTs(fixture)).toEqual(entityCounters(fixture));
  });
});


describe('PARITY: entity-page-match .mjs vs .ts twin', () => {
  // The batch writers use the .mjs; the /api/books/[id]/index route (a fourth
  // writer of this same index) uses the .ts. If they drift, one writer starts
  // attributing pages the other would reject.
  const NAMES = [
    'Matthiolus',
    'Saint Perpetua',
    'James Smart',
    'Marcus Aurelius Antoninus',
    'Job',
    'Papus (Gérard Encausse)',
    'Johannes Trithemius',
    '',
  ];
  const TEXTS = [
    'cuius exactissimus explanator est Matthiolus, huic Fuchsius',
    'octaue of saint stephen and the passion of Perpetua',
    'are smartly uibrated against the medium of our sight',
    'nato duno lucio cesare & di aurelia romani',
    'pseudonym of gerard encausse, a leading figure',
    'Iohannes Trithemius abbas Spanheimensis',
    'the book of Job',
  ];

  it.each(NAMES)('normalizeForMatch agrees for %j', (n) => {
    expect(normalizeTs(n)).toBe(normalizeForMatch(n));
  });

  it.each(TEXTS)('normalizeForMatch agrees on page text %j', (t) => {
    expect(normalizeTs(t)).toBe(normalizeForMatch(t));
  });

  it('pageMatchesEntity agrees across every name × text pair', () => {
    for (const name of NAMES) {
      const mjs = buildEntityMatcher(name);
      const ts = buildMatcherTs(name);
      expect(ts.stems.slice().sort()).toEqual(mjs.stems.slice().sort());
      expect(ts.patterns.map(String).sort()).toEqual(mjs.patterns.map(String).sort());
      for (const text of TEXTS) {
        const norm = normalizeForMatch(text);
        expect(
          pageMatchesTs(ts, norm),
          `${name} vs ${text}`
        ).toBe(pageMatchesEntity(mjs, norm));
      }
    }
  });

  it('attributeEntityPages agrees, including the section fallback', () => {
    const raw = [
      { page_number: 47, ocr: { data: 'de arte medica nihil' }, translation: { data: '' } },
      { page_number: 48, ocr: { data: 'explanator est Matthiolus' }, translation: { data: '' } },
      { page_number: 49, ocr: { data: 'sequitur Fuchsius' }, translation: { data: '' } },
    ];
    expect(buildPageTextsTs(raw)).toEqual(buildPageTexts(raw));
    for (const name of ['Matthiolus', 'Paracelsus', 'Job']) {
      expect(attributeTs(name, buildPageTextsTs(raw)))
        .toEqual(attributeEntityPages(name, buildPageTexts(raw)));
    }
  });
});

/**
 * The writer set.
 *
 * #3361 fixed four writers of `entities.books[]`. There were five — the tenant
 * twin of the index route was missed, and it kept doing both of the things the
 * fix removed: crediting every page of a Gemini batch to every entity in it,
 * and `$addToSet`-ing a whole book subdocument (which compares the entire
 * object, so a re-index appends a SECOND entry for the same book). CLAUDE.md's
 * remedy was "grep for the writer set before declaring one fixed"; this does
 * that grep on every run, so a sixth writer cannot arrive unnoticed.
 */
describe('entities.books[] writer set', () => {
  const WRITERS = [
    'scripts/workers/enrich-worker.mjs',
    'scripts/batch/batch-generate-indexes.mjs',
    'src/app/api/entities/route.ts',
    'src/app/api/books/[id]/index/route.ts',
    'src/app/api/[tenant]/books/[id]/index/route.ts',
  ];

  const read = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');

  it.each(WRITERS)('%s never $addToSet a whole book subdocument', (rel) => {
    const src = read(rel);
    // `$addToSet: { aliases: ... }` is fine — a set of strings is what it is for.
    // `$addToSet: { books: {...} }` is the duplication bug.
    expect(src).not.toMatch(/\$addToSet\s*:\s*\{[^}]*\bbooks\s*:/s);
  });

  it.each(WRITERS)('%s writes one entry per book, not an appended second', (rel) => {
    const src = read(rel);
    // Two legitimate shapes. Incremental writers (the extractors) remove this
    // book's entry and push a fresh one. The rebuild route accumulates into a
    // Map keyed by book_id and $sets the whole array, so it cannot duplicate.
    const pullPush = /\$pull\s*:\s*\{\s*books\s*:/.test(src) && /\$push\s*:\s*\{\s*books\s*:/.test(src);
    const wholeArrayReplace = /\bbooks:\s*booksArray\b/.test(src);
    expect(pullPush || wholeArrayReplace).toBe(true);
  });

  it.each(WRITERS)('%s never claims a page it did not verify', (rel) => {
    const src = read(rel);
    // Extractors verify a name against that page's text via the shared matcher.
    // The rebuild route has no page text — it carries the precision marker
    // forward and normalizeEntityBook demotes any legacy row that lacks one,
    // so it can't launder smeared pages back into citations either.
    const verifies = src.includes('attributeEntityPages');
    const carriesPrecision = src.includes('normalizeEntityBook');
    expect(verifies || carriesPrecision).toBe(true);
  });

  it.each(WRITERS.filter(w => !w.includes('batch-generate')))(
    '%s derives counters from the deduped array',
    (rel) => {
      // total_mentions must count VERIFIED references and book_count DISTINCT
      // books; summing raw page-array lengths over duplicated entries is how one
      // entity advertised "10,700 total mentions" of smeared page slots.
      expect(read(rel)).toContain('entityCounters');
    },
  );
});
