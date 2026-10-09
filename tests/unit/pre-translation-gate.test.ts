/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS modules under test are untyped */
/**
 * The pre-translation gate (#5915): a page the pipeline could not have read is refused before the
 * model is called, with a reason, and is never deleted.
 *
 * Fixtures are real pages (tests/fixtures/pre-translation-gate/pages.json, `ocr.data` verbatim).
 * The positives are the cases in the issue; every rule has a negative control from the calibration
 * draw — the legible page that sits closest to the rule's threshold.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  preTranslationVerdict, bookStructure, bookVerdict, applyPreTranslationGate, imageFingerprint, imageBox, aksharaCount, devanagariShape,
  preGateEnabled, preGateBookReason, isPreGateBookRefusal, REFUSAL, BOOK_REFUSAL, PRE_GATE_BLOCK, BOOK_REFUSAL_EVENT, PIXELS_PER_LETTER_FLOOR,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/pre-translation-gate.mjs';

const C = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/pre-translation-gate/pages.json'), 'utf8')).cases as Record<string, any>;
const light = (p: any, extra: any = {}) => ({ id: p.id, page_number: p.page_number, page_type: p.page_type, image_width: p.image_width, image_height: p.image_height, archive_metadata: p.archive_metadata, crop: p.crop, archived_photo: p.archived_photo, has_ocr: true, ...extra });

describe('rule 1 — the image is too small for its text', () => {
  it('refuses the scroll strip: 727 characters "read" off a 2000×121 px frame', () => {
    const v = preTranslationVerdict(C.scroll_strip);
    expect(v).toMatchObject({ refuse: true, reason: REFUSAL.IMAGE_TOO_SMALL, detail: { kind: 'strip', image: '2000x121' } });
  });
  it('refuses a CJK page under the density floor even when it is not a strip', () => {
    const v = preTranslationVerdict({ ...C.scroll_strip, image_width: 600, image_height: 400 });
    expect(v).toMatchObject({ refuse: true, reason: REFUSAL.IMAGE_TOO_SMALL, detail: { kind: 'density', family: 'CJK', floor: PIXELS_PER_LETTER_FLOOR.CJK } });
  });
  it('NEGATIVE CONTROL: one section of the same scroll at 2000×1020 px goes to the translator', () => {
    expect(preTranslationVerdict(C.scroll_section).refuse).toBe(false);
  });
  it('NEGATIVE CONTROL: the densest legible page of the draw (166 px² a letter) is not refused', () => {
    expect(preTranslationVerdict(C.dense_latin).refuse).toBe(false);
  });
  it('NEGATIVE CONTROL: a pecha leaf is long and narrow, and is not a strip', () => {
    expect(imageBox(C.tibetan_pecha).aspect).toBeGreaterThan(6);
    expect(preTranslationVerdict(C.tibetan_pecha).refuse).toBe(false);
  });
  it('does not judge a page with no stored size, or a caption-length transcription', () => {
    expect(preTranslationVerdict({ ...C.scroll_strip, image_width: undefined, image_height: undefined }).refuse).toBe(false);
    expect(preTranslationVerdict({ ...C.scroll_strip, ocr: { data: '大方廣佛華嚴經卷第四十一' } }).refuse).toBe(false);
  });
  it('measures a page cut from a spread on its own half', () => {
    expect(imageBox({ image_width: 4000, image_height: 3000, crop: { xStart: 500, xEnd: 1000 } })).toMatchObject({ width: 2000, height: 3000 });
  });
});

describe('rule 2 — the transcription is word fragments', () => {
  it('refuses the Strijataka page read one syllable at a time', () => {
    const v = preTranslationVerdict(C.syllable_soup);
    expect(v).toMatchObject({ refuse: true, reason: REFUSAL.UNREADABLE, detail: { family: 'Devanagari' } });
    expect(v.detail.fragment_share).toBeGreaterThan(0.3);
  });
  it('NEGATIVE CONTROL: a page of the same manuscript read in words goes to the translator', () => {
    expect(preTranslationVerdict(C.sanskrit_read).refuse).toBe(false);
  });
  it('NEGATIVE CONTROL: Hindi prose is full of one-akshara words that are words', () => {
    expect(devanagariShape(C.hindi_prose.ocr.data).fragmentShare).toBeLessThan(0.1);
    expect(preTranslationVerdict(C.hindi_prose).refuse).toBe(false);
  });
  it('NEGATIVE CONTROL: a litany of seed syllables is not fragments', () => {
    expect(preTranslationVerdict(C.mantra_seeds).refuse).toBe(false);
  });
  it('counts a conjunct as one akshara and a final consonant as its own', () => {
    expect(aksharaCount('क्ष')).toBe(1);
    expect(aksharaCount('श्रीं')).toBe(1);
    expect(aksharaCount('नमः')).toBe(2);
  });
  it('has no row for a script it was not calibrated on: letter-spaced Latin is not judged', () => {
    const spaced = Array.from({ length: 300 }, (_, i) => 'EPISTOLARVM'[i % 11]).join(' ');
    expect(preTranslationVerdict({ id: 'x', page_number: 5, ocr: { data: spaced } }).refuse).toBe(false);
  });
});

describe('rule 3 — structure', () => {
  it('refuses a page whose number is not positive', () => {
    expect(preTranslationVerdict(C.negative_number)).toMatchObject({ refuse: true, reason: REFUSAL.PAGE_NUMBER, detail: { page_number: -145 } });
    expect(preTranslationVerdict({ ...C.sanskrit_read, page_number: 0 }).reason).toBe(REFUSAL.PAGE_NUMBER);
  });
  it('refuses every page sharing a page number, and not its neighbours', () => {
    const a = { ...C.sanskrit_read, id: 'a', page_number: 7 }, b = { ...C.sanskrit_read, id: 'b', page_number: 7 }, c = { ...C.sanskrit_read, id: 'c', page_number: 8, archive_metadata: { bytes: 5 } };
    const s = bookStructure([light(a), light(b), light(c)]);
    expect(preTranslationVerdict(a, s).reason).toBe(REFUSAL.DUPLICATE_PAGE_NUMBER);
    expect(preTranslationVerdict(b, s).reason).toBe(REFUSAL.DUPLICATE_PAGE_NUMBER);
    expect(preTranslationVerdict(c, s).refuse).toBe(false);
  });
  it('refuses the second page carrying one image, and keeps the first', () => {
    const s = bookStructure([light(C.duplicate_first), light(C.duplicate_second)]);
    expect(preTranslationVerdict(C.duplicate_first, s).refuse).toBe(false);
    expect(preTranslationVerdict(C.duplicate_second, s)).toMatchObject({ refuse: true, reason: REFUSAL.DUPLICATE_IMAGE, detail: { same_as_page: 19, evidence: 'stored-size' } });
  });
  it('NEGATIVE CONTROL: the two halves of one spread share a file and are not duplicates', () => {
    const left = { ...C.duplicate_first, crop: { xStart: 0, xEnd: 504 } }, right = { ...C.duplicate_second, crop: { xStart: 504, xEnd: 1000 } };
    expect(imageFingerprint(left)).not.toBe(imageFingerprint(right));
    expect(preTranslationVerdict(right, bookStructure([light(left), light(right)])).refuse).toBe(false);
  });
  it('a hash from the image host overrides the stored size, in both directions', () => {
    const s = bookStructure([light(C.duplicate_first), light(C.duplicate_second)]);
    const differ = new Map([[C.duplicate_first.id, 'aaa'], [C.duplicate_second.id, 'bbb']]);
    expect(preTranslationVerdict(C.duplicate_second, s, { imageHashes: differ }).refuse).toBe(false);
    const other = { ...C.duplicate_second, archive_metadata: { bytes: 1 } };
    const s2 = bookStructure([light(C.duplicate_first), light(other)]);
    const same = new Map([[C.duplicate_first.id, 'aaa'], [other.id, 'aaa']]);
    expect(preTranslationVerdict(other, s2, { imageHashes: same })).toMatchObject({ reason: REFUSAL.DUPLICATE_IMAGE, detail: { evidence: 'image-hash' } });
  });
  it('a page with no stored byte length is never a duplicate', () => {
    const a = { ...C.duplicate_first, archive_metadata: undefined }, b = { ...C.duplicate_second, archive_metadata: undefined };
    expect(imageFingerprint(a)).toBeNull();
    expect(preTranslationVerdict(b, bookStructure([light(a), light(b)])).refuse).toBe(false);
  });
});

describe('book rule — most of the book was never transcribed', () => {
  const book = (read: number, total: number) => bookStructure(Array.from({ length: total }, (_, i) => ({ id: `p${i}`, page_number: i + 1, has_ocr: i < read })));
  it('refuses a book with 25 of 356 pages transcribed (Samarāṅgaṇa Sūtradhāra II)', () => {
    const v = bookVerdict(book(25, 356));
    expect(v).toMatchObject({ reason: BOOK_REFUSAL, detail: { read: 25, translatable: 356 } });
    expect(isPreGateBookRefusal(preGateBookReason(v))).toBe(true);
  });
  it('NEGATIVE CONTROL: a book mostly transcribed, and a pamphlet, are not refused', () => {
    expect(bookVerdict(book(300, 356))).toBeNull();
    expect(bookVerdict(book(2, 12))).toBeNull();
  });
  it('does not count blank leaves or non-positive pages as pages owed a transcription', () => {
    const pages = [
      ...Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, page_number: i + 1, has_ocr: true })),
      ...Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, page_number: 21 + i, page_type: 'blank', has_ocr: false })),
      ...Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, page_number: -1 - i, has_ocr: false })),
    ];
    expect(bookVerdict(bookStructure(pages))).toBeNull();
  });
});

// ── applyPreTranslationGate: what is written, and what is never written ───────────────────────

function fakeDb(pages: any[]) {
  const writes: any[] = [];
  const events: any[] = [];
  const pagesCol = {
    find(filter: any) {
      const blockedOnly = filter['translation.health_blocked'] === PRE_GATE_BLOCK;
      const rows = pages.filter((p) => p.book_id === filter.book_id && (!blockedOnly || p.translation?.health_blocked === PRE_GATE_BLOCK))
        .map((p) => (blockedOnly ? p : light(p, { has_ocr: !!p.ocr?.data })));
      return { toArray: async () => rows };
    },
    bulkWrite: async (ops: any[]) => { writes.push(...ops.map((o) => ({ kind: 'stamp', ...o.updateOne }))); },
    updateMany: async (filter: any, update: any) => { writes.push({ kind: 'release', filter, update }); },
  };
  return {
    writes, events,
    collection(name: string) {
      if (name === 'pages') return pagesCol;
      if (name === 'book_events') return { updateOne: async (filter: any, update: any) => { events.push({ filter, update }); } };
      throw new Error(`unexpected collection ${name}`);
    },
  };
}
const inBook = (p: any, n: number, id: string) => ({ ...p, id, book_id: 'B', page_number: n });
const quiet = { log: () => {}, enabled: true, hashOf: async () => null, sizeOf: async () => null };

describe('applyPreTranslationGate', () => {
  const strip = inBook(C.scroll_strip, 1, 's'), section = inBook(C.scroll_section, 2, 'c'), soup = inBook(C.syllable_soup, 3, 'u');

  it('keeps the readable page, refuses the others, and stamps the reason and the measurement', async () => {
    const db = fakeDb([strip, section, soup]);
    const res = await applyPreTranslationGate(db, 'B', [strip, section, soup], quiet);
    expect(res.pages.map((p: any) => p.id)).toEqual(['c']);
    expect(res.counts).toEqual({ [REFUSAL.IMAGE_TOO_SMALL]: 1, [REFUSAL.UNREADABLE]: 1 });
    const stamps = db.writes.filter((w) => w.kind === 'stamp');
    expect(stamps.map((w) => w.filter.id)).toEqual(['s', 'u']);
    expect(stamps[0].update.$set).toMatchObject({ 'translation.health_blocked': PRE_GATE_BLOCK, 'translation.refusal_reason': REFUSAL.IMAGE_TOO_SMALL });
    expect(stamps[0].update.$set['translation.refusal'].detail.image).toBe('2000x121');
  });
  it('never deletes, and never touches the transcription or an existing translation', async () => {
    const db = fakeDb([strip, section, soup]);
    await applyPreTranslationGate(db, 'B', [strip, section, soup], quiet);
    for (const w of db.writes) {
      expect(w.update.$unset ?? {}).toEqual({});
      for (const key of Object.keys(w.update.$set)) expect(key === 'updated_at' || /^translation\.(health_blocked|health_blocked_at|refusal_reason|refusal)$/.test(key)).toBe(true);
    }
  });
  it('a dry run judges and counts and writes nothing', async () => {
    const db = fakeDb([strip, section, soup]);
    const res = await applyPreTranslationGate(db, 'B', [strip, section, soup], { ...quiet, record: false });
    expect(res.refused).toHaveLength(2);
    expect(db.writes).toEqual([]);
  });
  it('TRANSLATE_PRE_GATE=0 turns it off; anything else leaves it on', async () => {
    expect(preGateEnabled({ TRANSLATE_PRE_GATE: '0' })).toBe(false);
    expect(preGateEnabled({})).toBe(true);
    const db = fakeDb([strip]);
    const res = await applyPreTranslationGate(db, 'B', [strip], { ...quiet, enabled: false });
    expect(res.pages).toEqual([strip]);
    expect(db.writes).toEqual([]);
  });
  it('asks the image host before calling two pages the same image, and believes it', async () => {
    const first = inBook(C.duplicate_first, 19, 'd1'), second = inBook(C.duplicate_second, 20, 'd2');
    const same = await applyPreTranslationGate(fakeDb([first, second]), 'B', [first, second], { ...quiet, hashOf: async () => 'etag-1' });
    expect(same.refused.map((r: any) => [r.page.id, r.reason, r.detail.evidence])).toEqual([['d2', REFUSAL.DUPLICATE_IMAGE, 'image-hash']]);
    const differ = await applyPreTranslationGate(fakeDb([first, second]), 'B', [first, second], { ...quiet, hashOf: async (url: string) => url });
    expect(differ.refused).toEqual([]);
    const unreachable = await applyPreTranslationGate(fakeDb([first, second]), 'B', [first, second], { ...quiet, hashOf: async () => null });
    expect(unreachable.refused.map((r: any) => r.detail.evidence)).toEqual(['stored-size']);
  });
  it('reads the image file before calling it too small: a stale stored size does not refuse a full-size page', async () => {
    const stale = await applyPreTranslationGate(fakeDb([strip]), 'B', [strip], { ...quiet, sizeOf: async () => ({ width: 10840, height: 5533 }) });
    expect(stale.refused).toEqual([]);
    const really = await applyPreTranslationGate(fakeDb([strip]), 'B', [strip], { ...quiet, sizeOf: async () => ({ width: 2000, height: 121 }) });
    expect(really.refused.map((r: any) => r.detail.evidence)).toEqual(['image-header']);
    const unreachable = await applyPreTranslationGate(fakeDb([strip]), 'B', [strip], quiet);
    expect(unreachable.refused.map((r: any) => r.detail.evidence)).toEqual(['stored-size']);
  });
  it('THE EXIT: a page refused earlier is released once its transcription passes', async () => {
    const reread = { ...soup, ocr: { data: C.sanskrit_read.ocr.data }, translation: { health_blocked: PRE_GATE_BLOCK, refusal_reason: REFUSAL.UNREADABLE } };
    const still = { ...strip, translation: { health_blocked: PRE_GATE_BLOCK, refusal_reason: REFUSAL.IMAGE_TOO_SMALL } };
    const db = fakeDb([still, section, reread]);
    const res = await applyPreTranslationGate(db, 'B', [section], quiet);
    expect(res.released).toBe(1);
    const release = db.writes.find((w) => w.kind === 'release');
    expect(release.filter.id.$in).toEqual(['u']);
    expect(Object.keys(release.update.$unset).sort()).toEqual(['translation.health_blocked', 'translation.health_blocked_at', 'translation.refusal', 'translation.refusal_reason']);
  });
  it('a book under half transcribed sends nothing, stamps no page, and is counted once in book_events', async () => {
    const pages = Array.from({ length: 40 }, (_, i) => ({ ...C.sanskrit_read, id: `p${i}`, book_id: 'B', page_number: i + 1, archive_metadata: { bytes: 1000 + i }, ocr: i < 5 ? C.sanskrit_read.ocr : undefined }));
    const db = fakeDb(pages);
    const res = await applyPreTranslationGate(db, 'B', pages.slice(0, 5), { ...quiet, lane: 'test' });
    expect(res.pages).toEqual([]);
    expect(res.book).toMatchObject({ reason: BOOK_REFUSAL, detail: { read: 5, translatable: 40 } });
    expect(db.writes).toEqual([]);
    expect(db.events).toHaveLength(1);
    expect(db.events[0].filter).toMatchObject({ book_id: 'B', type: BOOK_REFUSAL_EVENT });
  });
  it('the book rule is skipped for an operator page list; the page rules still apply', async () => {
    const pages = Array.from({ length: 40 }, (_, i) => ({ ...C.sanskrit_read, id: `p${i}`, book_id: 'B', page_number: i + 1, archive_metadata: { bytes: 1000 + i }, ocr: i < 5 ? (i === 0 ? C.syllable_soup.ocr : C.sanskrit_read.ocr) : undefined }));
    const res = await applyPreTranslationGate(fakeDb(pages), 'B', pages.slice(0, 5), { ...quiet, bookRule: false });
    expect(res.book).toBeNull();
    expect(res.pages).toHaveLength(4);
    expect(res.counts).toEqual({ [REFUSAL.UNREADABLE]: 1 });
  });
  it('a gate that cannot run lets the pages through and says so', async () => {
    const broken = { collection: () => { throw new Error('mongo down'); } };
    const res = await applyPreTranslationGate(broken, 'B', [strip], quiet);
    expect(res.pages).toEqual([strip]);
    expect(res.error).toMatch(/mongo down/);
  });
});
