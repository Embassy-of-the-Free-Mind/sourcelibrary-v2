/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * The image-set gate (scripts/lib/image-set-gate.mjs, v3#466). The shapes are the ones met on 2026-11-17: an e-rara book
 * whose PDF cover sheet is stored as page 1 (every image one leaf behind its row), the same book after the archiver's
 * count check stamped it, a repaired book, an unreachable source, and a book archived under two mappings.
 */
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
// @ts-ignore -- plain .mjs
import { imageSetVerdict, imageSetReadRefusal, imageSetRecord, verdictOfVotes, combineVerdicts, bookImageSet, SHIFT_PRONE_WRITERS, imageSetLaneStep, imageSetRepaired, gateWriteOffs, shiftPronePageMatch, isSettledVerdict, IMAGE_SET_RECHECK_DAYS } from '../../scripts/lib/image-set-gate.mjs';

// A 64-bit hash per leaf, far apart from every other leaf's (random 64-bit values differ in ~32 bits).
const leafHash = (n: number) => ((BigInt(n + 1) * 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn).toString(16).padStart(16, '0');
const SOURCE = (n: number) => `https://www.e-rara.ch/i3f/v21/${1000 + n}/full/1000,/0/default.jpg`;
const ARCHIVED = (n: number) => `https://images.example/archived/book/${n}.jpg`;

/** A book of `n` pages. `shift`: archived image N shows leaf N - shift(N). Leaf 0 is e-rara's cover sheet. */
function book(n: number, shift: (page: number) => number, extra: (page: number) => any = () => ({})) {
  const pages = Array.from({ length: n }, (_, i) => ({ page_number: i + 1, photo: SOURCE(i + 1), archived_photo: ARCHIVED(i + 1), archive_metadata: { source: 'erara_pdf', ...extra(i + 1) } }));
  const shown = new Map<string, number>();
  for (const p of pages) { shown.set(SHIFT_PRONE_WRITERS.erara_pdf.small(p.photo), p.page_number); shown.set(p.archived_photo, p.page_number - shift(p.page_number)); }
  const fetched: string[] = [];
  const hashUrl = async (url: string) => { fetched.push(url); if (!shown.has(url)) throw new Error(`unexpected url ${url}`); return leafHash(shown.get(url)!); };
  return { pages, hashUrl, fetched };
}
const now = () => new Date('2026-11-17T00:00:00Z');

describe('imageSetVerdict', () => {
  it('refuses a book whose stored images run one leaf behind their rows', async () => {
    const b = book(40, () => 1);
    const v = await imageSetVerdict(b.pages, null, { hashUrl: b.hashUrl, now });
    expect(v.verdict).toBe('shifted');
    expect(v.writers.erara_pdf.votes).toEqual({ aligned: 0, shift: 5, checked: 5 });
    expect(imageSetReadRefusal(v)).toMatch(/one leaf off/);
  });

  it('reads an aligned book and records how it was checked', async () => {
    const b = book(40, () => 0);
    const v = await imageSetVerdict(b.pages, null, { hashUrl: b.hashUrl, now });
    expect(v.verdict).toBe('aligned');
    expect(imageSetReadRefusal(v)).toBeNull();
    expect(imageSetRecord(v)).toEqual({ verdict: 'aligned', method: 'dhash-vs-source/5', checked_at: '2026-11-17T00:00:00.000Z', writers: { erara_pdf: { aligned: 5, shift: 0, checked: 5 } } });
  });

  it('fetches each image once', async () => {
    const b = book(40, () => 0);
    await imageSetVerdict(b.pages, null, { hashUrl: b.hashUrl, now });
    expect(new Set(b.fetched).size).toBe(b.fetched.length);
  });

  it('refuses a book archived under two mappings', async () => {
    const b = book(40, (n) => (n > 20 ? 1 : 0));
    const v = await imageSetVerdict(b.pages, null, { hashUrl: b.hashUrl, now });
    expect(v.verdict).toBe('mixed');
    expect(imageSetReadRefusal(v)).toMatch(/two mappings/);
  });

  it('does not sample pages the archiver stamped with its count-checked offset', async () => {
    const b = book(40, () => 1, () => ({ pdf_leaf_offset: 1 }));
    const v = await imageSetVerdict(b.pages, null, { hashUrl: b.hashUrl, now });
    expect(v.verdict).toBe('not_applicable');
    expect(b.fetched).toEqual([]);
    expect(imageSetRecord(v)).toBeNull();
  });

  it('takes a repaired and verified book as aligned without fetching', async () => {
    const b = book(40, () => 1);
    const v = await imageSetVerdict(b.pages, { archive_metadata: { jp2_offset_repaired: true, jp2_offset_post_verdict: 'aligned' } }, { hashUrl: b.hashUrl, now });
    expect(v.verdict).toBe('aligned');
    expect(v.writers.erara_pdf.by).toBe('jp2_offset_repaired');
    expect(b.fetched).toEqual([]);
  });

  it('does not trust a repair whose own check did not come back aligned', async () => {
    const b = book(40, () => 1);
    const v = await imageSetVerdict(b.pages, { archive_metadata: { jp2_offset_repaired: true, jp2_offset_post_verdict: 'ambiguous' } }, { hashUrl: b.hashUrl, now });
    expect(v.verdict).toBe('shifted');
  });

  it('reads a book whose source cannot be reached, and says it is unverified', async () => {
    const b = book(40, () => 0);
    const v = await imageSetVerdict(b.pages, null, { hashUrl: async () => { throw new Error('http 503'); }, now });
    expect(v.verdict).toBe('unknown');
    expect(imageSetReadRefusal(v)).toBeNull();
    expect(imageSetRecord(v).verdict).toBe('unverified');
  });

  it('leaves a book no shift-prone writer touched alone', async () => {
    const pages = Array.from({ length: 30 }, (_, i) => ({ page_number: i + 1, photo: `https://example.org/iiif/${i}/full/max/0/default.jpg`, archived_photo: ARCHIVED(i + 1), archive_metadata: { source: 'uva_iiif' } }));
    const v = await imageSetVerdict(pages, null, { hashUrl: async () => { throw new Error('should not fetch'); }, now });
    expect(v.verdict).toBe('not_applicable');
  });
});

describe('vote rules', () => {
  it('one abstaining sample does not turn a good book away', () => {
    expect(verdictOfVotes({ aligned: 1, shift: 0, checked: 5 })).toBe('aligned');
  });
  it('one shifted sample with none aligned is a shift (the repair script\'s rule)', () => {
    expect(verdictOfVotes({ aligned: 0, shift: 1, checked: 5 })).toBe('shifted');
  });
  it('no decided sample is unknown', () => {
    expect(verdictOfVotes({ aligned: 0, shift: 0, checked: 5 })).toBe('unknown');
    expect(verdictOfVotes(undefined)).toBe('unknown');
  });
  it('the worst writer decides the book', () => {
    expect(combineVerdicts(['aligned', 'shifted'])).toBe('shifted');
    expect(combineVerdicts(['aligned', 'unknown'])).toBe('unknown');
    expect(combineVerdicts([])).toBe('not_applicable');
  });
});

describe('bookImageSet', () => {
  it('reads the book once and keeps the verdict in the cache it was given', async () => {
    const b = book(12, () => 1);
    let finds = 0;
    const db = { collection: (name: string) => (name === 'books'
      ? { findOne: async () => { finds++; return { id: 'x' }; } }
      : { find: () => ({ toArray: async () => b.pages }) }) };
    const cache: Record<string, any> = {};
    const first = await bookImageSet(db, 'x', cache, { hashUrl: b.hashUrl, now });
    const again = await bookImageSet(db, 'x', cache, { hashUrl: b.hashUrl, now });
    expect(first.verdict).toBe('shifted');
    expect(again).toBe(first);
    expect(finds).toBe(1);
    expect(cache.x.verdict).toBe('shifted');
  });
});

describe('the writers are the ones the repair script repairs', () => {
  const repair = fs.readFileSync('scripts/maintenance/repair-bulk-jp2-offset.mjs', 'utf8');
  for (const [name, w] of Object.entries(SHIFT_PRONE_WRITERS) as [string, any][]) {
    it(`${name}: same source pattern`, () => {
      expect(repair).toContain(`${name}: {`);
      expect(repair).toContain(`re: ${String(w.re)}`);
    });
  }
});

describe('every reader that writes through cli-ocr.mjs passes the gate', () => {
  const src = fs.readFileSync('scripts/batch/cli-ocr.mjs', 'utf8');
  it('read and apply both ask it', () => {
    expect(src.match(/imageSetReadRefusal\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("skip(m, 'image set off its page rows (image-set gate, v3#466)')");
    expect(src).toContain('image_set: imageSetRecord(imageSet)');
  });
});

// The lane side (v3#466, 2026-11-18): the Latin first-read lane drew the same refused books every hour, charged their
// pages to the run and wrote them off in its ledger. These pin the rule that a refused book costs nothing.
describe('imageSetLaneStep: what a lane does before it draws a book', () => {
  const NOW = Date.parse('2026-11-18T12:00:00Z');
  const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
  const step = (o: any) => imageSetLaneStep({ shiftProne: true, checksLeft: 5, now: NOW, ...o });

  it('reads a book the gate has nothing to sample in, whatever is on record', () => {
    expect(step({ shiftProne: false, known: { verdict: 'shifted', at: at(0) } })).toBe('read');
  });
  it('does not draw a book refused within the recheck window', () => {
    expect(step({ known: { verdict: 'shifted', at: at(1) } })).toBe('wait');
    expect(step({ known: { verdict: 'mixed', at: at(IMAGE_SET_RECHECK_DAYS - 1) } })).toBe('wait');
    expect(step({ known: { verdict: 'shifted', at: at(1) }, checksLeft: 0 })).toBe('wait');
  });
  it('reads a refused book at once when a repair has stamped it', () => {
    const repaired = { archive_metadata: { jp2_offset_repaired: true, jp2_offset_post_verdict: 'aligned' } };
    expect(imageSetRepaired(repaired)).toBe(true);
    expect(step({ book: repaired, known: { verdict: 'shifted', at: at(0) } })).toBe('read');
    expect(imageSetRepaired({ archive_metadata: { jp2_offset_repaired: true, jp2_offset_post_verdict: 'shifted' } })).toBe(false);
  });
  it('samples a refused book again after the window', () => {
    expect(step({ known: { verdict: 'shifted', at: at(IMAGE_SET_RECHECK_DAYS + 1) } })).toBe('check');
  });
  it('reads a book a recent check found aligned without sampling it again', () => {
    expect(step({ known: { verdict: 'aligned', at: at(2) }, checksLeft: 0 })).toBe('read');
  });
  it('checks an unchecked book while the run has checks left, and leaves it for later when it has none', () => {
    expect(step({ known: null })).toBe('check');
    expect(step({ known: null, checksLeft: 0 })).toBe('later');
  });
  it('reads a book whose source did not answer, and asks again after a day, not every run', () => {
    expect(isSettledVerdict('unknown')).toBe(false);
    expect(step({ known: { verdict: 'unknown', at: at(0.5) }, checksLeft: 0 })).toBe('read');
    expect(step({ known: { verdict: 'unknown', at: at(2) } })).toBe('check');
    expect(step({ known: { verdict: 'unknown', at: at(2) }, checksLeft: 0 })).toBe('later');
  });
});

describe('gateWriteOffs: the ledger rows a refusal wrote off', () => {
  const row = (page_id: string, book_id: string, outcome: string, why: string) => JSON.stringify({ page_id, book_id, page_number: 1, outcome, why });
  const ledger = [
    row('p1', 'shifted-book', 'failed', 'not_read'),
    row('p2', 'shifted-book', 'failed', 'reply wrapper: text outside the markers'),   // the model was called: a real attempt
    row('p3', 'shifted-book', 'written', 'written'),
    row('p4', 'good-book', 'failed', 'not_read'),                                     // another book's failed fetch
    row('p5', 'shifted-book', 'failed', 'not_read'),
    row('p5', 'shifted-book', 'released', 'image-set gate'),                          // already released
    row('p6', 'shifted-book', 'failed', 'not_read'),
    row('p6', 'shifted-book', 'written', 'written'),                                  // read later
    'not json',
  ].join('\n');

  it('releases only the pages of refused books whose last row is an empty read', () => {
    expect(gateWriteOffs(ledger, new Set(['shifted-book']))).toEqual([{ page_id: 'p1', book_id: 'shifted-book', page_number: 1 }]);
  });
  it('releases nothing when no book was refused', () => {
    expect(gateWriteOffs(ledger, new Set())).toEqual([]);
  });
});

describe('the first-read lane asks the gate before it charges a page', () => {
  const lane = fs.readFileSync('scripts/batch/cli-ocr-lane.mjs', 'utf8');
  const main = lane.slice(lane.indexOf('async function firstReadMain'));
  it('decides wait / later / check before the book is claimed or its pages are taken', () => {
    const stepAt = main.indexOf('const step = imageSetLaneStep({ shiftProne: shiftProne.has(b.id)');
    expect(stepAt).toBeGreaterThan(0);
    expect(stepAt).toBeLessThan(main.indexOf('if (!claimBook(CLAIMS_DIR, b.id, ME)) continue;'));
    expect(stepAt).toBeLessThan(main.indexOf('budget -= take.length;'));
  });
  it('gives the pages back and ledgers nothing when the reader itself refuses the book', () => {
    const refund = main.indexOf('budget += take.length; tally.books--; booksTaken--;');
    expect(main.lastIndexOf('if (imageSetReadRefusal(readerSet)) {', refund)).toBeGreaterThan(0);
    expect(refund).toBeGreaterThan(0);
    expect(refund).toBeLessThan(main.indexOf('fs.appendFileSync(LEDGER, JSON.stringify({ page_id: p.id, book_id: book.id'));
  });
  it('a released ledger row takes its page out of the ledger', () => {
    expect(lane).toContain("if (r.outcome === 'released') set.delete(r.page_id); else set.add(r.page_id);");
  });
  it('the frame query stays on three early rows of each book', () => {
    const m = shiftPronePageMatch(['a', 'b']);
    expect(m.book_id).toEqual({ $in: ['a', 'b'] });
    expect(m.page_number).toEqual({ $in: [2, 3, 4] });
    expect([...m['archive_metadata.source'].$in].sort()).toEqual(Object.keys(SHIFT_PRONE_WRITERS).sort());
  });
});
