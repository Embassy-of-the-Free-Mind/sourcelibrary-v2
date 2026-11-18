/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * The image-set gate (scripts/lib/image-set-gate.mjs, v3#466). The shapes are the ones met on 2026-11-17: an e-rara book
 * whose PDF cover sheet is stored as page 1 (every image one leaf behind its row), the same book after the archiver's
 * count check stamped it, a repaired book, an unreachable source, and a book archived under two mappings.
 */
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
// @ts-ignore -- plain .mjs
import { imageSetVerdict, imageSetReadRefusal, imageSetRecord, verdictOfVotes, combineVerdicts, bookImageSet, SHIFT_PRONE_WRITERS } from '../../scripts/lib/image-set-gate.mjs';

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
